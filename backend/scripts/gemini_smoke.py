"""Build-order step 1: one test call through the shared client. Needs GEMINI_API_KEY in .env."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config, explainer  # noqa: E402
from app.engine import Shock, build_plan  # noqa: E402
from app.gemini_client import GeminiError, get_client  # noqa: E402

if __name__ == "__main__":
    if config.gemini_disabled():
        sys.exit("No GEMINI_API_KEY (or GEMINI_DISABLED=1). Put the key in backend/.env")
    base = {"income": 3000, "spending": 2600, "buffer": 5200, "household_bills": 900, "months_of_history": 40}
    flex = {"card_withdrawals": 420, "cash_withdrawals": 150, "transfers_out_other": 110}
    plan = build_plan(base, flex, Shock(0.55, 6))
    t0 = time.monotonic()
    try:
        raw = get_client().generate_json(explainer.SYSTEM_PROMPT, str(plan).replace("'", '"'),
                                         explainer.ExplanationSchema)
    except GeminiError as e:
        sys.exit(f"FAILED: {e}")
    clean, why = explainer.validate(raw, plan)
    print(f"{time.monotonic() - t0:.2f}s model={config.gemini_model()} valid={bool(clean)} {why}")
    print(raw)
