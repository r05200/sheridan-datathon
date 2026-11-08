"""account_metrics computation: needs the CSVs, not a database."""
import importlib.util
from pathlib import Path

import pytest

from app.account_metrics import compute_account_metrics, metrics_for
from app.engine import Shock, build_plan, runway
from app.planning import PlanningOptions

spec = importlib.util.spec_from_file_location(
    "prepare_data", Path(__file__).resolve().parents[2] / "scripts" / "prepare_data.py")
prepare_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_data)


@pytest.fixture(scope="module")
def rows(data_dir):
    return compute_account_metrics(data_dir)


def test_hand_checked_account(rows):
    r = next(x for x in rows if x["account_id"] == 20111)
    assert r["income"] == pytest.approx(6339.39) and r["months_of_history"] == 38
    assert r["loan_payment"] == pytest.approx(2330.19)
    assert r["runway_months"] == 7.8 and r["has_shortfall"] and not r["runway_capped"]
    assert r["monthly_shortfall"] == pytest.approx(2260.215)
    assert r["goal_target_amount"] == pytest.approx(25798.82) and r["goal_months_to_goal"] is None


def test_every_account_once_and_nothing_missing(rows):
    ids = [r["account_id"] for r in rows]
    assert len(ids) == 4500 == len(set(ids)) and ids == sorted(ids)
    required = [k for k in rows[0] if k not in ("runway_months", "goal_months_to_goal")]
    assert all(r[k] is not None for r in rows for k in required)


def test_invariants_for_every_account(rows):
    for r in rows:
        a = r["account_id"]
        assert (r["runway_months"] is None) == (not r["has_shortfall"]), a
        if r["runway_capped"]:
            assert r["runway_months"] == 120, a
        assert 0 <= r["goal_progress_pct"] <= 100, a
        assert r["monthly_shortfall"] == 0 or r["monthly_surplus"] == 0, a
        assert r["goal_target_months"] == 3 and r["goal_amount_still_needed"] >= 0, a
        assert (r["goal_months_to_goal"] == 0) == (r["goal_amount_still_needed"] == 0), a


def test_runway_matches_the_challenge_formula_for_every_account(rows):
    for r in rows:
        want = runway(r["buffer"], r["income"], r["spending"])
        if want == "no_shortfall":
            assert r["runway_months"] is None, r["account_id"]
        else:
            assert r["runway_months"] == pytest.approx(want, abs=0.05), r["account_id"]


def test_zero_buffer_counts_as_shortfall_with_zero_runway():
    base = {"income": 5000.0, "spending": 3000.0, "household_bills": 0.0, "fixed_costs": 0.0,
            "buffer": -10.0, "months_of_history": 30}
    r = metrics_for(1, base, {"card_withdrawals": 0.0, "cash_withdrawals": 0.0, "transfers_out_other": 0.0}, 0.0)
    assert r["has_shortfall"] is True and r["runway_months"] == 0.0 and r["goal_progress_pct"] == 0


def test_stored_values_equal_the_live_engine_plan(rows):
    for r in rows[::150]:
        base = {k: r[k] for k in ("income", "spending", "household_bills", "fixed_costs", "buffer",
                                  "months_of_history")}
        flex = {k: r[k] for k in ("card_withdrawals", "cash_withdrawals", "transfers_out_other")}
        plan = build_plan(base, flex, Shock(), r["account_id"], PlanningOptions())
        assert r["goal_target_amount"] == pytest.approx(plan["goal_plan"]["target_amount"], abs=0.5)  # box shows whole $
        assert r["goal_target_amount"] == plan["action_plan"]["goal"]["target_amount"]               # plan shows cents
        assert r["goal_months_to_goal"] == plan["goal_plan"]["months_to_goal"]


def test_matches_independent_teammate_pipeline_logic(rows):
    """scripts/prepare_data.py has its own baseline_runway; compare it on every shortfall account."""
    for r in rows:
        months, status, capped = prepare_data.baseline_runway(r["buffer"], r["spending"], r["income"])
        if status == "shortfall":
            assert r["runway_months"] == months and r["runway_capped"] == capped, r["account_id"]
        elif status == "no_shortfall":
            assert not r["has_shortfall"], r["account_id"]
        else:
            assert r["runway_months"] == 0.0, r["account_id"]
