"""The one place Gemini is called: 4s timeout, one retry, logging, structured JSON, temperature 0.

Both the Plan Explainer and the Shock Parser go through `generate_json`. Callers must treat
GeminiError as "use the fallback" (template explanation / sliders).
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import time
from typing import Any

from . import config

log = logging.getLogger("tangerine.gemini")
_POOL = cf.ThreadPoolExecutor(max_workers=8, thread_name_prefix="gemini")


class GeminiError(RuntimeError):
    """API unavailable, timed out, disabled, or returned unparseable output."""


class GeminiClient:
    def __init__(self, timeout_s: float = config.GEMINI_TIMEOUT_S, retries: int = 1,
                 temperature: float = 0.0):
        self.timeout_s = timeout_s
        self.retries = retries
        self.temperature = temperature
        self._client = None

    def _sdk(self):
        if self._client is None:
            from google import genai
            from google.genai import types
            self._client = genai.Client(
                api_key=config.gemini_api_key(),
                http_options=types.HttpOptions(timeout=int(self.timeout_s * 1000)),
            )
        return self._client

    def _call(self, system: str, user: str, schema: Any) -> str:
        from google.genai import types
        resp = self._sdk().models.generate_content(
            model=config.gemini_model(),
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=self.temperature,
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        return resp.text or ""

    def generate_json(self, system: str, user: str, schema: Any,
                      budget_s: float | None = None) -> dict:
        """Return parsed JSON within `budget_s` seconds total (default: the 4s PRD limit),
        retry included. Raises GeminiError on any failure so callers fall back."""
        if config.gemini_disabled():
            raise GeminiError("Gemini disabled or no API key configured")
        budget = self.timeout_s if budget_s is None else budget_s
        if budget <= 0:
            raise GeminiError("no time budget left")
        deadline = time.monotonic() + budget
        fut = _POOL.submit(self._generate_blocking, system, user, schema, deadline)
        try:
            return fut.result(timeout=budget)
        except cf.TimeoutError:
            log.warning("gemini exceeded %.1fs budget", budget)
            raise GeminiError(f"Gemini exceeded {budget:.1f}s budget") from None

    def _generate_blocking(self, system: str, user: str, schema: Any, deadline: float) -> dict:
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            if time.monotonic() >= deadline:
                break
            t0 = time.monotonic()
            try:
                text = self._call(system, user, schema)
                data = json.loads(text)
                if not isinstance(data, dict):
                    raise ValueError("response is not a JSON object")
                log.info("gemini ok attempt=%d %.2fs req=%s resp=%s", attempt,
                         time.monotonic() - t0, user[:500], text[:500])
                return data
            except Exception as e:  # noqa: BLE001 - any failure means fall back
                last = e
                log.warning("gemini fail attempt=%d %.2fs req=%s err=%r", attempt,
                            time.monotonic() - t0, user[:500], e)
        raise GeminiError(f"Gemini call failed: {last!r}")


_default: GeminiClient | None = None


def get_client() -> GeminiClient:
    global _default
    if _default is None:
        _default = GeminiClient()
    return _default
