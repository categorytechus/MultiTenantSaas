"""
Web Scraper Utility
====================
A generic, configurable web scraper that collects articles, summaries,
and PDFs on any topic using DuckDuckGo search.

Driven entirely by config.json — no hardcoded topics or domains.
Outputs both CSV and JSON for easy consumption by AI agents.

Install:
    pip install -r requirements.txt
Run:
    python scraper.py
    python scraper.py --config custom_config.json
"""

import os
import re
import csv
import json
import time
import argparse
import threading
import requests
import nltk
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup
from ddgs import DDGS

import trafilatura

from sumy.parsers.plaintext import PlaintextParser
from sumy.nlp.tokenizers import Tokenizer
from sumy.summarizers.lsa import LsaSummarizer

nltk.download("punkt",     quiet=True)
nltk.download("punkt_tab", quiet=True)

# ───────────────────────────────────────────────────────────────────────────
# DEFAULTS — used when config.json doesn't specify a field
# ───────────────────────────────────────────────────────────────────────────
DEFAULTS = {
    "max_results":       8,
    "summary_lines":     3,
    "request_delay":     1.5,
    "query_delay":       4.0,
    "output_folder":     "output",
    "credentials_file":  "credentials.txt",
    "login_enabled":     True,
    "blocked_domains": [
        "youtube.com", "youtu.be",
        "twitter.com", "x.com",
        "t.me", "telegram.org",
        "reddit.com", "facebook.com",
        "instagram.com", "google.com/finance",
        "scribd.com",
    ],
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Login configs loaded from login_configs.json at runtime
LOGIN_CONFIGS = {}

def load_login_configs(path: str = "login_configs.json") -> dict:
    """Load site-specific Selenium login instructions from JSON file."""
    if not os.path.exists(path):
        print(f"  [AUTH] No login_configs.json found at '{path}' — login disabled.")
        return {}
    with open(path, "r") as f:
        configs = json.load(f)
    print(f"  [AUTH] Loaded login configs for: {list(configs.keys())}")
    return configs


# ───────────────────────────────────────────────────────────────────────────
# CONFIG LOADER
# ───────────────────────────────────────────────────────────────────────────
def load_config(path: str) -> dict:
    """Load config.json and fill missing fields with defaults."""
    with open(path, "r") as f:
        config = json.load(f)

    # Apply defaults for any missing optional fields
    for key, value in DEFAULTS.items():
        if key not in config:
            config[key] = value

    # Validate required fields
    if "topic" not in config:
        raise ValueError("config.json must include a 'topic' field.")
    if "queries" not in config or not config["queries"]:
        raise ValueError("config.json must include at least one query.")

    return config


# ───────────────────────────────────────────────────────────────────────────
# CREDENTIALS LOADER
# ───────────────────────────────────────────────────────────────────────────
def load_credentials(filepath: str) -> dict:
    """
    Read credentials.txt and return:
    { "domain.com": ("email", "password"), ... }
    """
    creds = {}
    if not os.path.exists(filepath):
        print(f"  [AUTH] No credentials file at '{filepath}' — skipping login.")
        return creds
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) == 3:
                domain, email, password = parts
                creds[domain] = (email, password)
                print(f"  [AUTH] Loaded credentials for: {domain}")
    return creds


# ───────────────────────────────────────────────────────────────────────────
# SELENIUM LOGIN
# ───────────────────────────────────────────────────────────────────────────
def selenium_login(domain: str, email: str, password: str) -> dict:
    """
    Log into a site using Selenium headless browser.
    Returns cookies dict on success, empty dict on failure.
    """
    cookies = {}
    try:
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.chrome.options import Options
        from webdriver_manager.chrome import ChromeDriverManager
        from selenium.webdriver.chrome.service import Service

        print(f"  [AUTH] Launching browser for {domain}...")

        options = Options()
        options.add_argument("--headless")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_argument(f"user-agent={HEADERS['User-Agent']}")

        driver = webdriver.Chrome(
            service=Service(ChromeDriverManager().install()),
            options=options
        )

        config = LOGIN_CONFIGS[domain]
        driver.get(config["login_url"])
        time.sleep(3)

        wait = WebDriverWait(driver, 15)

        for sel in config["email_selector"].split(","):
            try:
                el = wait.until(EC.presence_of_element_located(
                    (By.CSS_SELECTOR, sel.strip())))
                el.clear()
                el.send_keys(email)
                break
            except Exception:
                continue

        for sel in config["pass_selector"].split(","):
            try:
                el = driver.find_element(By.CSS_SELECTOR, sel.strip())
                el.clear()
                el.send_keys(password)
                break
            except Exception:
                continue

        for sel in config["submit_selector"].split(","):
            try:
                btn = driver.find_element(By.CSS_SELECTOR, sel.strip())
                btn.click()
                break
            except Exception:
                continue

        time.sleep(4)

        if config["success_check"].lower() in driver.page_source.lower():
            print(f"  [AUTH] ✓ Login successful for {domain}")
        else:
            print(f"  [AUTH] ⚠ Login may have failed for {domain} — using cookies anyway")

        for cookie in driver.get_cookies():
            cookies[cookie["name"]] = cookie["value"]

        driver.quit()
        print(f"  [AUTH] {len(cookies)} cookies extracted for {domain}")

    except ImportError:
        print("  [AUTH] Selenium not installed. Run: pip install selenium webdriver-manager")
    except Exception as e:
        print(f"  [AUTH] Login failed for {domain}: {e}")

    return cookies


# ───────────────────────────────────────────────────────────────────────────
# STEP 1 — DuckDuckGo search
# ───────────────────────────────────────────────────────────────────────────
def search_duckduckgo(query: str, max_results: int) -> list[dict]:
    """Search DuckDuckGo and return list of {title, url, snippet}."""
    print(f"\n  Searching: '{query}'")
    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title":   r.get("title", ""),
                    "url":     r.get("href",  ""),
                    "snippet": r.get("body",  ""),
                })
    except Exception as e:
        print(f"  DDG error: {e}")
    print(f"  Found {len(results)} results.")
    return results


# ───────────────────────────────────────────────────────────────────────────
# STEP 2 — Summarize with sumy LSA
# ───────────────────────────────────────────────────────────────────────────
def summarize_text(text: str, sentence_count: int) -> str:
    """Extract key sentences using LSA algorithm."""
    if not text or len(text.split()) < 30:
        return text.strip()

    # Cap at 1000 words — prevents hangs on huge documents
    words = text.split()
    if len(words) > 1000:
        text = " ".join(words[:1000])

    result = [None]
    error  = [None]

    def _run():
        try:
            parser     = PlaintextParser.from_string(text, Tokenizer("english"))
            summarizer = LsaSummarizer()
            summary    = summarizer(parser.document, sentence_count)
            result[0]  = " ".join(str(s) for s in summary)
        except Exception as e:
            error[0] = str(e)

    t = threading.Thread(target=_run)
    t.start()
    t.join(timeout=10)   # give up after 10 seconds

    if t.is_alive():
        return "[Summary skipped: took too long]"
    if error[0]:
        return f"[Summary error: {error[0]}]"
    return result[0] or ""


# ───────────────────────────────────────────────────────────────────────────
# STEP 3 — Scrape a single page
# ───────────────────────────────────────────────────────────────────────────
def scrape_page(url: str, topic: str, summary_lines: int,
                session: requests.Session = None,
                topic_aliases: list = None) -> dict:
    """
    Fetch a page and extract:
      - headline  : H1 tag
      - body      : full clean text via trafilatura (better than raw <p> tags)
      - summary   : LSA extractive summary
      - pdf_links : PDFs whose URL or anchor text mentions the topic
    """
    data = {
        "headline":  "",
        "body":      "",
        "summary":   "",
        "pdf_links": [],
        "error":     "",
    }

    try:
        requester = session if session else requests
        resp = requester.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()

        # ── Headline ────────────────────────────────────────────────────────
        soup = BeautifulSoup(resp.text, "lxml")
        h1   = soup.find("h1")
        data["headline"] = h1.get_text(strip=True) if h1 else "N/A"

        # ── Body text via trafilatura (strips ads, nav, footers) ────────────
        body = trafilatura.extract(
            resp.text,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
        ) or ""

        # Fallback to BeautifulSoup <p> tags if trafilatura returns nothing
        if not body:
            paragraphs = soup.find_all("p")
            body = " ".join(
                p.get_text(strip=True) for p in paragraphs
                if len(p.get_text(strip=True)) > 40
            )

        data["body"]    = body[:5000]
        data["summary"] = summarize_text(body, summary_lines)

        # ── PDF links — topic relevance filter ──────────────────────────────
        pdf_links = []
        for a in soup.find_all("a", href=True):
            href     = a["href"]
            alt_text = a.get_text(strip=True).lower()

            if not (href.lower().endswith(".pdf") or "pdf" in href.lower()):
                continue

            # Resolve relative URLs
            if not href.startswith("http"):
                from urllib.parse import urljoin
                href = urljoin(url, href)

            # Must mention the topic or alias in URL or anchor text
            # Exception: if URL itself ends in .pdf, download it directly
            # since the page context already confirms relevance
            if not href.lower().endswith(".pdf"):
                aliases = [topic.lower()] + [a.lower() for a in (topic_aliases or [])]
                if not any(a in href.lower() or a in alt_text for a in aliases):
                    continue

            pdf_links.append(href)

        data["pdf_links"] = list(set(pdf_links))

    except requests.exceptions.HTTPError as e:
        data["error"] = f"HTTP {e.response.status_code}"
    except Exception as e:
        data["error"] = str(e)

    return data


# ───────────────────────────────────────────────────────────────────────────
# STEP 4 — Download PDFs
# ───────────────────────────────────────────────────────────────────────────
def download_pdf(pdf_url: str, folder: str) -> str:
    """Download a PDF. Returns filepath on success, error string on failure."""
    os.makedirs(folder, exist_ok=True)

    raw_name = pdf_url.split("/")[-1].split("?")[0].strip()
    filename  = re.sub(r"[^\w\-.]", "_", raw_name)
    if not filename or filename == ".pdf" or len(filename) < 5:
        filename = f"doc_{int(time.time())}.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"

    filepath = os.path.join(folder, filename)

    # Retry up to 3 times with exponential backoff
    for attempt in range(3):
        try:
            resp = requests.get(pdf_url, headers=HEADERS, timeout=15, stream=True)
            resp.raise_for_status()
            with open(filepath, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"        PDF saved → {filepath}")
            return filepath
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)   # 1s, 2s, 4s
            else:
                print(f"        PDF failed: {e}")
                return f"ERROR: {e}"


# ───────────────────────────────────────────────────────────────────────────
# STEP 5 — Save results to CSV and JSON
# ───────────────────────────────────────────────────────────────────────────
def save_results(records: list[dict], config: dict) -> None:
    """Save all scraped records to both CSV and JSON in the output folder."""
    folder = config["output_folder"]
    os.makedirs(folder, exist_ok=True)

    # ── CSV ─────────────────────────────────────────────────────────────────
    csv_path   = os.path.join(folder, "results.csv")
    fieldnames = [
        "label", "title", "url", "snippet",
        "headline", "summary", "body", "pdf_links", "error"
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for rec in records:
            row = rec.copy()
            row["pdf_links"] = " | ".join(rec.get("pdf_links", []))
            writer.writerow(row)
    print(f"\n  CSV saved  → {csv_path}")

    # ── JSON ─────────────────────────────────────────────────────────────────
    json_path = os.path.join(folder, "results.json")
    output = {
        "topic":       config["topic"],
        "scraped_at":  datetime.now().isoformat(),
        "total":       len(records),
        "results":     records,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"  JSON saved → {json_path}")


# ───────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ───────────────────────────────────────────────────────────────────────────
def main():
    # ── Parse CLI argument for config file path ──────────────────────────────
    parser = argparse.ArgumentParser(description="Generic Web Scraper Utility")
    parser.add_argument(
        "--config", default="config.json",
        help="Path to config JSON file (default: config.json)"
    )
    args = parser.parse_args()

    # ── Load config ──────────────────────────────────────────────────────────
    config = load_config(args.config)
    topic  = config["topic"]

    print("=" * 60)
    print(f"  Web Scraper Utility")
    print(f"  Topic  : {topic}")
    print(f"  Queries: {len(config['queries'])}")
    print("=" * 60)

    # ── Selenium login ───────────────────────────────────────────────────────
    sessions = {}
    LOGIN_CONFIGS.update(load_login_configs(
        config.get("login_configs_file", "login_configs.json")
    ))
    if config.get("login_enabled", True):
        credentials = load_credentials(config["credentials_file"])
        for domain, (email, password) in credentials.items():
            if domain not in LOGIN_CONFIGS:
                print(f"  [AUTH] No login config for {domain} — skipping.")
                continue
            cookies = selenium_login(domain, email, password)
            if cookies:
                s = requests.Session()
                s.cookies.update(cookies)
                sessions[domain] = s
                print(f"  [AUTH] Session ready for {domain}")

    # ── Scraping loop ────────────────────────────────────────────────────────
    all_records = []
    seen_urls   = set()
    total_pdfs  = 0
    pdf_folder  = os.path.join(config["output_folder"], "pdfs")

    for query_item in config["queries"]:
        label = query_item["label"]
        query = query_item["query"]

        print(f"\n[{label.upper()}]")
        results = search_duckduckgo(query, config["max_results"])

        # Collect valid URLs for this query
        valid_results = []
        for i, result in enumerate(results, 1):
            url = result["url"]

            if any(blocked in url for blocked in config["blocked_domains"]):
                print(f"  [{i}] Skipping (blocked domain): {url[:60]}")
                continue

            if url in seen_urls:
                print(f"  [{i}] Skipping (duplicate): {url[:60]}")
                continue

            seen_urls.add(url)
            valid_results.append((i, result))

        # ── Parallel scraping ────────────────────────────────────────────────
        def scrape_with_meta(args):
            i, result = args
            url = result["url"]

            session = None
            for domain, sess in sessions.items():
                if domain in url:
                    session = sess
                    break

            auth_label = "(authenticated) " if session else ""
            print(f"  [{i}] Scraping {auth_label}: {url[:65]}")

            page = scrape_page(
                url, topic,
                config["summary_lines"],
                session=session,
                topic_aliases=config.get("topic_aliases", [])
            )
            return i, result, page

        # Phase 1 — Scrape all pages in parallel (fast)
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {executor.submit(scrape_with_meta, item): item
                       for item in valid_results}

            for future in as_completed(futures):
                try:
                    i, result, page = future.result()
                    url = result["url"]

                    if page["error"]:
                        print(f"  [{i}] Error: {page['error']}")
                        continue

                    word_count = len(page["body"].split())
                    if word_count < 50:
                        print(f"  [{i}] Skipping (too little content: {word_count} words)")
                        continue

                    combined = (page["headline"] + page["body"]).lower()
                    aliases   = [topic.lower()] + [
                        a.lower() for a in config.get("topic_aliases", [])
                    ]
                    if not any(alias in combined for alias in aliases):
                        print(f"  [{i}] Skipping (topic not mentioned)")
                        continue

                    print(f"  [{i}] ✓ Headline : {page['headline'][:65]}")
                    print(f"       Summary  : {page['summary'][:100]}...")
                    print(f"       PDFs     : {len(page['pdf_links'])}")

                    record = {
                        "label":     label,
                        "title":     result["title"],
                        "url":       url,
                        "snippet":   result["snippet"],
                        "headline":  page["headline"],
                        "summary":   page["summary"],
                        "body":      page["body"],
                        "pdf_links": page["pdf_links"],
                        "error":     page["error"],
                    }
                    all_records.append(record)

                except Exception as e:
                    print(f"  Scrape error: {e}")

        time.sleep(config["query_delay"])

    # Phase 2 — Download all PDFs after scraping is done (deduplicated)
    print(f"\n  Downloading PDFs...")
    seen_pdfs = set()
    all_pdf_links = []
    for rec in all_records:
        for pdf_url in rec.get("pdf_links", []):
            if pdf_url not in seen_pdfs:
                seen_pdfs.add(pdf_url)
                all_pdf_links.append(pdf_url)

    print(f"  Found {len(all_pdf_links)} unique PDFs to download.")
    for pdf_url in all_pdf_links:
        res = download_pdf(pdf_url, pdf_folder)
        if not res.startswith("ERROR"):
            total_pdfs += 1
        time.sleep(config["request_delay"])

    # ── Save results ─────────────────────────────────────────────────────────
    save_results(all_records, config)

    print("\n" + "=" * 60)
    print(f"  Topic            : {topic}")
    print(f"  Articles scraped : {len(all_records)}")
    print(f"  PDFs downloaded  : {total_pdfs}")
    print(f"  Authenticated    : {list(sessions.keys()) or 'None'}")
    print(f"  Output folder    : {config['output_folder']}/")
    print("=" * 60)


if __name__ == "__main__":
    main()