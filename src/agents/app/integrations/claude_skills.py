"""
Claude Skills API client for report generation (agents service).

Uses the Anthropic Python SDK to call Claude with Skills (beta) and
code execution, producing HTML/PDF reports inside a sandboxed container.
"""
import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

logger = logging.getLogger(__name__)


class ClaudeSkillsClient:
    """Client for Claude Skills API (beta) — report generation."""

    def __init__(
        self,
        api_key: str,
        skill_id: str,
        skill_version: str = "latest",
        model: str = "claude-sonnet-4-20250514",
    ) -> None:
        import anthropic

        self.client = anthropic.Anthropic(api_key=api_key)
        self.skill_id = skill_id
        self.skill_version = skill_version
        self.model = model
        self._executor = ThreadPoolExecutor(max_workers=2)

    async def generate_report(self, data: dict[str, Any]) -> dict[str, str]:
        """
        Send structured report data to Claude with the cost-seg Skills context.

        Returns ``{"html": "<full HTML string>"}`` or raises on failure.
        """

        def _call() -> Any:
            return self.client.beta.messages.create(
                model=self.model,
                max_tokens=16384,
                betas=["code-execution-2025-08-25", "skills-2025-10-02"],
                container={
                    "skills": [
                        {
                            "type": "custom",
                            "skill_id": self.skill_id,
                            "version": self.skill_version,
                        }
                    ]
                },
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Generate a cost segregation study report from the "
                            "following structured data.  Save the HTML report to "
                            "/output/report.html\n\n"
                            f"{json.dumps(data, default=str)}"
                        ),
                    }
                ],
                tools=[
                    {"type": "code_execution_20250825", "name": "code_execution"}
                ],
            )

        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(self._executor, _call)
        return self._extract_output(response)

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_output(response: Any) -> dict[str, str]:
        """Walk response content blocks and pull the generated HTML."""
        html: str | None = None

        for block in response.content:
            block_type = getattr(block, "type", None)

            # Code-execution results may contain output files
            if block_type == "code_execution_result":
                for output in getattr(block, "content", []):
                    out_type = getattr(output, "type", None)
                    if out_type == "file":
                        fname = getattr(output, "filename", "")
                        if fname.endswith(".html"):
                            html = getattr(output, "content", None)

            # Fallback: if Claude put raw HTML in a text block
            if block_type == "text" and html is None:
                text = block.text.strip()
                if text.startswith("<!DOCTYPE") or text.startswith("<html"):
                    html = text

        if not html:
            raise ValueError(
                "Claude Skills response did not contain an HTML report file"
            )

        logger.info(
            "Claude Skills report generated (html_length=%d, stop_reason=%s)",
            len(html),
            getattr(response, "stop_reason", None),
        )
        return {"html": html}
