"""
PDF image extraction and batch captioning service.

Flow:
  1. extract_images_from_pdf()  — uses pypdf + PIL + pdfplumber
     • Extracts image bytes from each PDF page
     • Skips images smaller than MIN_IMAGE_SIZE x MIN_IMAGE_SIZE
     • SHA-256 dedup
     • Finds nearby text captions via pdfplumber spatial layout
     • Scores each image with a heuristic (no LLM needed)
     • Returns top MAX_IMAGES candidates

  2. caption_images_batch()  — single Bedrock or Gemini API call
     • Sends all candidate images in one multi-image prompt
     • Returns model-generated captions per image
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

MIN_IMAGE_SIZE = 100   # px — skip images smaller than this in either dimension
MAX_IMAGES = 20        # max candidates sent to the captioning LLM


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class ExtractedImage:
    image_bytes: bytes
    page: int           # 0-indexed page number
    image_index: int    # index within the page
    width: int
    height: int
    format: str         # 'PNG' | 'JPEG' | ...
    pdf_caption: str    # nearby text found by pdfplumber (may be empty)
    priority_score: float
    content_hash: str   # SHA-256 hex of image bytes


@dataclass
class CaptionedImage:
    image: ExtractedImage
    model_caption: str


# ── Extraction ────────────────────────────────────────────────────────────────

def extract_images_from_pdf(body: bytes) -> list[ExtractedImage]:
    """
    Extract candidate images from a PDF byte blob.

    Returns a scored, deduplicated, size-filtered list of up to MAX_IMAGES
    ExtractedImage objects sorted by priority_score descending.
    """
    try:
        import pypdf
    except ImportError:
        logger.error("pypdf not installed — cannot extract PDF images")
        return []

    try:
        from PIL import Image as PilImage
    except ImportError:
        logger.error("Pillow not installed — cannot process PDF images")
        return []

    # pdfplumber is optional for caption extraction — degrade gracefully
    try:
        import pdfplumber
        _pdfplumber_available = True
    except ImportError:
        logger.warning("pdfplumber not installed — PDF captions will be skipped")
        _pdfplumber_available = False

    reader = pypdf.PdfReader(io.BytesIO(body))
    seen_hashes: set[str] = set()
    candidates: list[ExtractedImage] = []

    # Pre-load pdfplumber pages for caption detection
    plumber_pages: list | None = None
    if _pdfplumber_available:
        try:
            import pdfplumber as _pdfplumber
            pdf_plumber = _pdfplumber.open(io.BytesIO(body))
            plumber_pages = pdf_plumber.pages
        except Exception as e:
            logger.warning("pdfplumber failed to open PDF: %s", e)

    for page_num, page in enumerate(reader.pages):
        # In pypdf >= 3.0, page.images automatically extracts embedded images
        # from the page's resources, handling filters and formats.
        img_idx_on_page = 0
        for image_file in page.images:
            img_bytes = image_file.data
            if not img_bytes:
                continue

            # Get dimensions via PIL
            try:
                pil_img = PilImage.open(io.BytesIO(img_bytes))
                width, height = pil_img.size
                fmt = pil_img.format or "PNG"
                # Normalise to PNG/JPEG
                if fmt not in ("PNG", "JPEG", "JPG"):
                    buf = io.BytesIO()
                    pil_img.convert("RGB").save(buf, format="PNG")
                    img_bytes = buf.getvalue()
                    fmt = "PNG"
            except Exception as e:
                logger.debug("PIL failed on page %d image %d: %s", page_num, img_idx_on_page, e)
                img_idx_on_page += 1
                continue

            # Size filter
            if width < MIN_IMAGE_SIZE or height < MIN_IMAGE_SIZE:
                img_idx_on_page += 1
                continue

            # Dedup by SHA-256
            content_hash = hashlib.sha256(img_bytes).hexdigest()

            # Find nearby caption via pdfplumber spatial layout
            pdf_caption = ""
            if plumber_pages and page_num < len(plumber_pages):
                try:
                    pdf_caption = _find_caption(plumber_pages[page_num], img_idx_on_page)
                except Exception as e:
                    logger.debug("pdfplumber caption extraction failed on page %d: %s", page_num, e)

            # Heuristic score
            score = _score_image(
                width=width,
                height=height,
                pdf_caption=pdf_caption,
                content_hash=content_hash,
                seen_hashes=seen_hashes,
                page_num=page_num,
                total_pages=len(reader.pages),
            )

            if content_hash not in seen_hashes:
                seen_hashes.add(content_hash)
                candidates.append(ExtractedImage(
                    image_bytes=img_bytes,
                    page=page_num,
                    image_index=img_idx_on_page,
                    width=width,
                    height=height,
                    format=fmt,
                    pdf_caption=pdf_caption,
                    priority_score=score,
                    content_hash=content_hash,
                ))

            img_idx_on_page += 1

    # Sort by priority score, return top MAX_IMAGES
    candidates.sort(key=lambda x: x.priority_score, reverse=True)
    selected = candidates[:MAX_IMAGES]
    logger.info("Image extraction: %d raw images → %d selected", len(candidates), len(selected))
    return selected



def _find_caption(plumber_page, image_index: int) -> str:
    """
    Look for text that matches caption patterns (Figure X, Table X, Chart X)
    near where images typically appear. Returns the first matching text or "".
    """
    CAPTION_RE = re.compile(
        r"(Figure|Fig\.|Table|Chart|Exhibit|Diagram|Illustration)\s*\d*",
        re.IGNORECASE,
    )
    words = plumber_page.extract_words() or []
    text_lines: dict[float, list[str]] = {}
    for w in words:
        y = round(w["top"], 0)
        text_lines.setdefault(y, []).append(w["text"])

    # Find lines matching caption pattern
    for y, tokens in sorted(text_lines.items()):
        line = " ".join(tokens)
        if CAPTION_RE.search(line):
            return line[:200]
    return ""


def _score_image(
    *,
    width: int,
    height: int,
    pdf_caption: str,
    content_hash: str,
    seen_hashes: set[str],
    page_num: int,
    total_pages: int,
) -> float:
    """Heuristic priority score — higher = more likely to be a meaningful image."""
    score = 0.0

    # Image area: normalise to 0–5 pts (full-page ~1M px → 5 pts)
    area = width * height
    score += min(5.0, area / 200_000)

    # PDF caption bonus
    STRONG_CAP = re.compile(r"(Figure|Fig\.|Table|Chart|Exhibit|Diagram)\s*\d+", re.I)
    if STRONG_CAP.search(pdf_caption):
        score += 5.0
    elif pdf_caption.strip():
        score += 2.0

    # Aspect ratio: penalise banners/separators (very wide or very tall)
    ratio = max(width, height) / max(min(width, height), 1)
    if ratio <= 3.0:
        score += 2.0
    elif ratio <= 5.0:
        score += 1.0
    # else: 0 — likely a decorative border or separator line

    # Dedup: only the first occurrence of a hash gets the bonus
    if content_hash not in seen_hashes:
        score += 3.0

    # Page position: content pages (not first/last) score slightly higher
    if total_pages > 2 and 0 < page_num < total_pages - 1:
        score += 1.0

    return score


# ── Captioning ────────────────────────────────────────────────────────────────

def caption_images_batch(images: list[ExtractedImage]) -> list[CaptionedImage]:
    """
    Send all images in a single Bedrock or Gemini API call and return
    one CaptionedImage per input image.

    Uses the CHAT_MODEL setting (same as the chat agent) to decide which
    API to call.  Falls back gracefully on errors.
    """
    if not images:
        return []

    try:
        from app.core.config import settings
        from app.integrations.llm import llm

        model = settings.CHAT_MODEL
        if model == "bedrock":
            client = llm._bedrock._get_client()
            if not client:
                logger.warning("BEDROCK_MODEL_ARN not set — skipping image captioning")
                return _fallback_captions(images)
            return _caption_bedrock(images, client, settings.BEDROCK_MODEL_ARN)
        elif model == "gemini":
            if not settings.GEMINI_API_KEY:
                logger.warning("GEMINI_API_KEY not set — skipping image captioning")
                return _fallback_captions(images)
            return _caption_gemini(images, settings.GEMINI_API_KEY, settings.GEMINI_MODEL)
        elif model == "anthropic":
            if not settings.ANTHROPIC_API_KEY:
                logger.warning("ANTHROPIC_API_KEY not set — skipping image captioning")
                return _fallback_captions(images)
            return _caption_anthropic(images, settings.ANTHROPIC_API_KEY)
        else:
            logger.warning("Unknown CHAT_MODEL '%s' — skipping image captioning", model)
            return _fallback_captions(images)
    except Exception as e:
        logger.error("Image captioning failed: %s", e, exc_info=True)
        return _fallback_captions(images)


def _build_caption_prompt(n: int) -> str:
    import sys
    import importlib.util
    from pathlib import Path

    # Map server's config to what agents' prompts.py expects
    import app.core.config as server_config
    if "app.config" not in sys.modules:
        sys.modules["app.config"] = server_config

    prompts_path = Path(__file__).resolve().parent.parent.parent.parent / "agents" / "app" / "prompts.py"
    spec = importlib.util.spec_from_file_location("agents_prompts", str(prompts_path))
    agents_prompts = importlib.util.module_from_spec(spec)
    
    # Execute module to load get_prompt
    spec.loader.exec_module(agents_prompts)
    
    return agents_prompts.get_prompt("caption-images", workflow="default", n=str(n), s="s" if n > 1 else "")


def _parse_caption_response(raw: str, n: int) -> list[str]:
    """Parse the LLM JSON response into a list of caption strings."""
    try:
        # Strip markdown fences if present
        clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.I)
        clean = re.sub(r"\s*```$", "", clean.strip())
        parsed = json.loads(clean)
        if isinstance(parsed, list):
            captions = []
            for item in parsed[:n]:
                if isinstance(item, dict):
                    captions.append(str(item.get("description", "")))
                else:
                    captions.append(str(item))
            # Pad if LLM returned fewer than n entries
            while len(captions) < n:
                captions.append("")
            return captions
    except Exception as e:
        logger.warning("Failed to parse caption response: %s\nRaw: %.200s", e, raw)
    return [""] * n


def _caption_bedrock(images: list[ExtractedImage], bedrock_client, model_id: str) -> list[CaptionedImage]:
    """Batch caption via Bedrock (Claude) using the messages API with inline images."""
    import base64

    content: list[dict] = []
    for i, img in enumerate(images, 1):
        media_type = "image/jpeg" if img.format.upper() in ("JPEG", "JPG") else "image/png"
        content.append({
            "type": "text",
            "text": f"Image {i}:"
        })
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.b64encode(img.image_bytes).decode(),
            },
        })
    content.append({"type": "text", "text": _build_caption_prompt(len(images))})

    response = bedrock_client.invoke_model(
        modelId=model_id,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": content}],
        }),
        contentType="application/json",
        accept="application/json",
    )
    raw = json.loads(response["body"].read())
    text_out = raw["content"][0]["text"] if raw.get("content") else ""
    captions = _parse_caption_response(text_out, len(images))
    return [CaptionedImage(image=img, model_caption=cap) for img, cap in zip(images, captions)]


def _caption_gemini(images: list[ExtractedImage], api_key: str, model_id: str) -> list[CaptionedImage]:
    """Batch caption via Gemini (google-genai SDK) using inline image parts."""
    import base64
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    parts: list = []
    for i, img in enumerate(images, 1):
        parts.append(types.Part(text=f"Image {i}:"))
        mime = "image/jpeg" if img.format.upper() in ("JPEG", "JPG") else "image/png"
        parts.append(
            types.Part(
                inline_data=types.Blob(
                    mime_type=mime,
                    data=base64.b64encode(img.image_bytes).decode(),
                )
            )
        )
    parts.append(types.Part(text=_build_caption_prompt(len(images))))

    response = client.models.generate_content(model=model_id, contents=parts)
    text_out = response.text or ""
    captions = _parse_caption_response(text_out, len(images))
    return [CaptionedImage(image=img, model_caption=cap) for img, cap in zip(images, captions)]


def _caption_anthropic(images: list[ExtractedImage], api_key: str) -> list[CaptionedImage]:
    """Batch caption via Anthropic Messages API with inline images."""
    import base64
    import anthropic

    from app.core.config import settings

    headers = {}
    if settings.ANTHROPIC_WORKSPACE_ID:
        headers["anthropic-workspace-id"] = settings.ANTHROPIC_WORKSPACE_ID

    client = anthropic.Anthropic(
        api_key=api_key,
        base_url=settings.ANTHROPIC_BASE_URL,
        default_headers=headers if headers else None,
    )

    content: list[dict] = []
    for i, img in enumerate(images, 1):
        media_type = "image/jpeg" if img.format.upper() in ("JPEG", "JPG") else "image/png"
        content.append({"type": "text", "text": f"Image {i}:"})
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.b64encode(img.image_bytes).decode(),
            },
        })
    content.append({"type": "text", "text": _build_caption_prompt(len(images))})

    response = client.messages.create(
        model=settings.CLAUDE_SKILLS_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )
    text_out = response.content[0].text if response.content else ""
    captions = _parse_caption_response(text_out, len(images))
    return [CaptionedImage(image=img, model_caption=cap) for img, cap in zip(images, captions)]


def _fallback_captions(images: list[ExtractedImage]) -> list[CaptionedImage]:
    """Return images with pdf_caption as model_caption when LLM is unavailable."""
    return [
        CaptionedImage(image=img, model_caption=img.pdf_caption or f"Image on page {img.page + 1}")
        for img in images
    ]
