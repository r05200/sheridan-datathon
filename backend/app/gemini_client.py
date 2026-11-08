"""The one place Gemini is called: one direct JSON request, configurable timeout, safe logging, local validation.

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
    """Safe failure category for callers; no credentials or raw provider text."""

    def __init__(self, message, kind="unavailable"):
        super().__init__(message)
        self.kind = kind


class GeminiClient:
    def __init__(self, timeout_s: float = config.GEMINI_TIMEOUT_S, retries: int = 0,
                 temperature: float = 0.0):
        self.timeout_s = timeout_s
        self.retries = retries
        self.temperature = temperature
        self._client = None

    def _call(self, system: str, user: str, schema: Any) -> str:
        """One direct JSON request: no provider-side nested schema or SDK retries."""
        import httpx
        model = config.gemini_model()
        generation = {"responseMimeType": "application/json", "maxOutputTokens": 2048}
        if model.startswith("gemini-3"):
            generation["thinkingConfig"] = {"thinkingLevel": "minimal" if "flash-lite" in model else "low"}
        else:
            generation["temperature"] = self.temperature
        try:
            response = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": config.gemini_api_key()},
                json={"systemInstruction": {"parts": [{"text": system}]},
                      "contents": [{"role": "user", "parts": [{"text": user}]}],
                      "generationConfig": generation},
                timeout=self.timeout_s,
            )
        except httpx.TimeoutException:
            raise GeminiError("Gemini HTTP request timed out", kind="timeout") from None
        except httpx.RequestError:
            raise GeminiError("Cannot reach Gemini", kind="connection") from None
        if response.status_code >= 400:
            kind = {404: "model_unavailable", 401: "credentials", 403: "credentials",
                    429: "quota"}.get(response.status_code, "unavailable")
            raise GeminiError(f"Gemini HTTP {response.status_code}", kind=kind)
        payload = response.json()
        text = "".join(part.get("text", "")
                       for candidate in payload.get("candidates", [])[:1]
                       for part in candidate.get("content", {}).get("parts", [])
                       if not part.get("thought"))
        if not text:
            raise GeminiError("Gemini returned no text", kind="invalid_response")
        return text

    def generate_json(self, system: str, user: str, schema: Any,
                      budget_s: float | None = None) -> dict:
        """Return parsed JSON within `budget_s` seconds total (default: configured timeout),
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
            raise GeminiError(f"Gemini exceeded {budget:.1f}s budget", kind="timeout") from None

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
                schema.model_validate(data)
                log.info("gemini ok attempt=%d %.2fs", attempt, time.monotonic() - t0)
                return data
            except Exception as e:  # noqa: BLE001 - any failure means fall back
                last = e
                if isinstance(e, GeminiError):
                    raise
                code = getattr(e, "code", None)
                log.warning("gemini fail attempt=%d %.2fs type=%s code=%s", attempt,
                            time.monotonic() - t0, type(e).__name__, code)
                if code in {400, 401, 403, 404, 429}:
                    break
        code = getattr(last, "code", None)
        kind = {404: "model_unavailable", 401: "credentials", 403: "credentials", 429: "quota"}.get(code, "unavailable")
        raise GeminiError(f"Gemini request failed ({kind})", kind=kind)


_default: GeminiClient | None = None


def get_client() -> GeminiClient:
    global _default
    if _default is None:
        _default = GeminiClient()
    return _default
