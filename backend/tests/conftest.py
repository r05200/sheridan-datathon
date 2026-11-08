import os
import sys
from pathlib import Path

# Tests never touch the network: Gemini off, and the app's database config is cleared.
# Database tests use TEST_DATABASE_URL (a local Postgres) and skip without it, e.g.
#   docker run -d --rm --name tangerine-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16
#   TEST_DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55432/postgres?sslmode=disable pytest
# Each run recreates account_metrics and loads it with the same code path as scripts/setup_db.py.
os.environ["GEMINI_DISABLED"] = "1"
for _name in ("DATABASE_URL", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_SSLMODE", "DB_DISABLED"):
    os.environ[_name] = ""             # empty (not removed): load_dotenv won't override it with backend/.env
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import importlib.util  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

DATA_DIR = Path(os.getenv("TANGERINE_DATA_DIR", Path.home() / "Downloads" / "data"))
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


def load_setup_db():
    spec = importlib.util.spec_from_file_location("setup_db", BACKEND_DIR / "scripts" / "setup_db.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def data_dir():
    if not (DATA_DIR / "monthly_summary.csv").exists():
        pytest.skip(f"CSV data not found at {DATA_DIR} (set TANGERINE_DATA_DIR)")
    return DATA_DIR


@pytest.fixture(scope="session")
def writer_engine(data_dir):
    """Writable engine on a test database loaded by exactly what scripts/setup_db.py runs."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set (local Postgres for database tests)")
    from app.account_metrics import compute_account_metrics
    from app.db import build_engine
    eng = build_engine({"url": TEST_DATABASE_URL, "sslmode": "disable"}, read_only=False,
                       statement_timeout_ms=0)
    try:
        load_setup_db().load(eng, compute_account_metrics(data_dir), reset=True)
    except OperationalError as e:
        pytest.skip(f"test database unreachable: {e.orig}")
    yield eng
    eng.dispose()


@pytest.fixture(scope="session")
def db_engine(writer_engine):
    """Read-only engine built exactly as the app builds it."""
    from app.db import build_engine, set_engine
    eng = build_engine({"url": TEST_DATABASE_URL, "sslmode": "disable"})
    set_engine(eng)
    yield eng
    set_engine(None)


@pytest.fixture
def session(db_engine):
    with Session(db_engine) as s:
        yield s


@pytest.fixture(autouse=True)
def fresh_cache():
    from app import explainer
    explainer.clear_cache()
    yield
    explainer.clear_cache()


class FakeClient:
    """Stands in for GeminiClient. `responses` are returned in order (dict) or raised (Exception)."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def generate_json(self, system, user, schema, budget_s=None):
        self.calls.append({"system": system, "user": user, "budget_s": budget_s})
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def no_database(monkeypatch):
    """No engine and no config: the app behaves as if the database was never set up.
    monkeypatch restores the shared test engine afterwards (set_engine(None) would dispose it)."""
    from app.db import session
    monkeypatch.setattr(session, "_engine", None)
    monkeypatch.setattr(session, "_factory", None)
