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
        base_url: str | None = None,
        workspace_id: str | None = None,
    ) -> None:
        import anthropic

        headers = {}
        if workspace_id:
            headers["anthropic-workspace-id"] = workspace_id

        self.client = anthropic.Anthropic(
            api_key=api_key,
            base_url=base_url,
            default_headers=headers if headers else None,
        )
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
                betas=[
                    "code-execution-2025-08-25",
                    "skills-2025-10-02",
                    "files-api-2025-04-14",
                ],
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

    def _extract_output(self, response: Any) -> dict[str, str]:
        """Extract the generated HTML or file ID from the Claude Skills response."""
        file_ids = []
        
        # Collect any file IDs from bash execution results
        for item in response.content:
            if getattr(item, "type", "") == "bash_code_execution_tool_result":
                content_item = getattr(item, "content", None)
                if content_item and getattr(content_item, "type", "") == "bash_code_execution_result":
                    # Log stdout/stderr for debugging
                    logger.debug("Bash execution stdout: %s", getattr(content_item, "stdout", ""))
                    logger.debug("Bash execution stderr: %s", getattr(content_item, "stderr", ""))
                    for file in getattr(content_item, "content", []):
                        fid = getattr(file, "file_id", None)
                        if fid:
                            file_ids.append(fid)
        
        if file_ids:
            file_id = file_ids[-1]
            logger.info("Found file_id in Claude response: %s", file_id)
        else:
            # Provide detailed block summary for debugging
            block_summary = [(getattr(b, "type", "unknown"), getattr(b, "content", None)) for b in response.content]
            logger.error("Claude Skills response missing file_id. Blocks: %s", block_summary)
            raise ValueError(f"Claude Skills response did not contain a generated file. Found blocks: {block_summary}")

        # Download the file content via Files API
        logger.info("Downloading HTML file via Files API: %s", file_id)
        file_content = self.client.beta.files.download(file_id=file_id)
        html = file_content.read().decode("utf-8")

        logger.info(
            "Claude Skills report generated (html_length=%d, stop_reason=%s)",
            len(html),
            getattr(response, "stop_reason", None),
        )
        return {"html": html}
