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
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def gemini_disabled() -> bool:
    return _flag("GEMINI_DISABLED") or gemini_api_key() is None


def database_url() -> str | None:
    return os.getenv("DATABASE_URL") or None


def db_disabled() -> bool:
    return _flag("DB_DISABLED") or database_url() is None


GEMINI_TIMEOUT_S = 4.0       # PRD: 4-second limit, shared by both parts
DB_CONNECT_TIMEOUT_S = 5     # PRD: 5-second connection timeout
OFFLINE_BASELINE_PATH = BACKEND_DIR / "data" / "account_baseline.csv"
EXPLAIN_CACHE_PATH = BACKEND_DIR / "data" / "explain_cache.json"
