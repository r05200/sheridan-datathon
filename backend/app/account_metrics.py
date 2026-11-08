"""Compute the per-account values the frontend displays (the `account_metrics` table).

Baseline numbers come from the pandas reference (judges' definitions, full precision). Everything
derived (runway, goal plan) comes from the plan engine itself with no shock, so the stored numbers
are exactly what the live app shows. This lives outside app/db/ because the engine imports app.db.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .baseline_calc import compute_baselines
from .engine import GOAL_MONTHS_OF_SPENDING, NO_SHORTFALL, Shock, build_plan
from .planning import PlanningOptions

BASELINE_KEYS = ("income", "spending", "household_bills", "fixed_costs", "buffer", "months_of_history")
FLEXIBLE_KEYS = ("card_withdrawals", "cash_withdrawals", "transfers_out_other")


def metrics_for(account_id: int, baseline: dict[str, float], flexible: dict[str, float],
                loan_payment: float) -> dict[str, Any]:
    """One account_metrics row from already-computed baseline values."""
    plan = build_plan(baseline, flexible, Shock(), account_id, PlanningOptions())
    runway = plan["baseline"]["runway_months"]
    goal = plan["action_plan"]["goal"]
    months_to_goal = plan["goal_plan"]["months_to_goal"]
    return {
        "account_id": account_id,
        **{k: float(baseline[k]) for k in BASELINE_KEYS if k != "months_of_history"},
        "months_of_history": int(baseline["months_of_history"]),
        "loan_payment": float(loan_payment),
        **{k: float(flexible[k]) for k in FLEXIBLE_KEYS},
        "runway_months": None if runway == NO_SHORTFALL else float(runway),
        "has_shortfall": runway != NO_SHORTFALL,
        "runway_capped": bool(plan["baseline"]["runway_capped"]),
        "monthly_shortfall": max(baseline["spending"] - baseline["income"], 0.0),
        "goal_target_months": GOAL_MONTHS_OF_SPENDING,
        "goal_target_amount": float(goal["target_amount"]),
        "goal_amount_still_needed": float(goal["amount_still_needed"]),
        "monthly_surplus": float(goal["available_monthly_saving"]),
        "goal_progress_pct": float(goal["progress_pct"]),
        "goal_months_to_goal": None if months_to_goal is None else float(months_to_goal),
    }


def compute_account_metrics(data_dir: Path) -> list[dict[str, Any]]:
    """All accounts, ordered by account_id. Reads monthly_summary.csv and loans.csv from data_dir."""
    rows = []
    for rec in compute_baselines(data_dir).sort_values("account_id").to_dict("records"):
        baseline = {k: rec[k] for k in BASELINE_KEYS}
        flexible = {k: rec[k] for k in FLEXIBLE_KEYS}
        rows.append(metrics_for(int(rec["account_id"]), baseline, flexible, rec["loan_payment"]))
    return rows
