import os
import sys
from pathlib import Path

# Tests never touch the network: Gemini off, DB off (offline export) unless a test opts in.
os.environ["GEMINI_DISABLED"] = "1"
os.environ["DB_DISABLED"] = "1"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

DATA_DIR = Path(os.getenv("TANGERINE_DATA_DIR", Path.home() / "Downloads" / "data"))


@pytest.fixture
def data_dir():
    if not (DATA_DIR / "monthly_summary.csv").exists():
        pytest.skip(f"CSV data not found at {DATA_DIR} (set TANGERINE_DATA_DIR)")
    return DATA_DIR


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
