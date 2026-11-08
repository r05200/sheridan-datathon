"""Pre-generate and cache explanations for the demo accounts (Gemini output only; templates are never cached).

Usage: python scripts/pregenerate.py 20111 20133 ...    (needs GEMINI_API_KEY)
Writes backend/data/explain_cache.json (git-ignored; regenerate on each machine).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import engine, explainer  # noqa: E402
from app.engine import OneOffCost, Shock  # noqa: E402

DEMO_SHOCKS = [
    Shock(income_multiplier=0.55, income_duration_months=6),
    Shock(income_multiplier=0.55, income_duration_months=6, household_bills_pct_change=15),
    Shock(one_off_costs=[OneOffCost("furnace repair", None, 1)]),
]

if __name__ == "__main__":
    ids = [int(a) for a in sys.argv[1:]] or sys.exit(__doc__)
    explainer.load_cache()
    for acct in ids:
        for shock in DEMO_SHOCKS:
            out = explainer.explain_plan(engine.plan_for_account(acct, shock))
            print(acct, shock.income_multiplier, out["source"])
    explainer.save_cache()
