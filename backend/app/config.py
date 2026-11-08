"""Environment-driven settings. Secrets come from env vars only (see .env.example)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _flag(name: str) -> bool:
    return os.getenv(name, "0").strip().lower() in {"1", "true", "yes", "on"}


def gemini_api_key() -> str | None:
    return os.getenv("GEMINI_API_KEY") or None


def gemini_model() -> str:
    # Undecided in the PRD: any fast Gemini model with structured JSON output works.
    return os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")


def gemini_disabled() -> bool:
    return _flag("GEMINI_DISABLED") or gemini_api_key() is None


def _timeout_seconds():
    value = float(os.getenv("GEMINI_TIMEOUT_S", "20"))
    if not 1 <= value <= 120:
        raise ValueError("GEMINI_TIMEOUT_S must be between 1 and 120 seconds")
    return value


GEMINI_TIMEOUT_S = _timeout_seconds()  # total per-operation budget, retries included
EXPLAIN_CACHE_PATH = BACKEND_DIR / "data" / "explain_cache.json"
