"""Anonymous, deterministic cohort comparisons; a spending benchmark is not a budget.

Ported from the vanilla-JS branch (project/app/peers.py). Peers are the closest accounts within
30% of income and 40% of fixed costs and loan payments (with a $200 floor on the cost tolerances)
that share the account's active-loan-payment status. The account itself is excluded.
"""
from __future__ import annotations

import math
from statistics import median
from typing import Any

from ..db.errors import AccountNotFound

MIN_PEERS = 10
MAX_PEERS = 50
REQUIRED = ("income", "fixed_costs", "loan_payment", "spending")

# (metric key, label, what to review when the account is above the peer median)
COMPARISONS = [
    ("spending", "Total monthly outflow",
     "Review the biggest recurring payments first. This total overlaps the channels below; do not add the gaps together."),
    ("household_bills", "Household bills",
     "Compare providers and recurring charges. Housing and utilities may be essential; only test changes you can actually make."),
    ("cash_withdrawals", "Cash withdrawals",
     "Check what the cash pays for. Identify optional purchases before choosing any reduction."),
    ("card_withdrawals", "Card withdrawals",
     "Review the underlying purchases before deciding whether any amount can be reduced."),
    ("transfers_out_other", "Other outgoing transfers",
     "Check the recipients and purpose. Transfers may cover bills, family support or movement between your own accounts."),
]

METHOD = {
    "income_tolerance_pct": 30, "fixed_cost_tolerance_pct": 40, "loan_payment_tolerance_pct": 40,
    "cost_tolerance_floor": 200, "minimum_peers": MIN_PEERS, "maximum_peers": MAX_PEERS,
    "description": ("Closest accounts within 30% of income and 40% of fixed costs and loan payments (a $200 "
                    "tolerance floor for costs), with the same active-loan-payment status. The selected account "
                    "is excluded."),
}
LIMITATIONS = ("These are account-level recorded spending medians, not verified household budgets. Withdrawals "
               "and transfers may pay for essentials; category and total gaps overlap.")


def _valid(row: dict[str, float]) -> bool:
    return all(math.isfinite(row.get(key, math.nan)) and row[key] >= 0 for key in REQUIRED)


def compare_peers(account_id: int, records: dict[int, dict[str, float]]) -> dict[str, Any]:
    """Benchmark one account's monthly outflows against the median of its closest peers."""
    target = records.get(account_id)
    if target is None:
        raise AccountNotFound(account_id)
    if not _valid(target):
        return {"status": "unavailable", "peer_count": 0, "method": METHOD, "comparisons": [],
                "message": "This account does not have enough valid matching data for a comparison."}

    scales = [max(target["income"] * 0.30, 1), max(target["fixed_costs"] * 0.40, 200),
              max(target["loan_payment"] * 0.40, 200)]
    candidates: list[tuple[float, int, dict[str, float]]] = []
    for other_id, row in records.items():
        if other_id == account_id or not _valid(row):
            continue
        if (row["loan_payment"] > 0) != (target["loan_payment"] > 0):
            continue
        distances = [abs(row[key] - target[key]) / scale
                     for key, scale in zip(("income", "fixed_costs", "loan_payment"), scales)]
        if all(d <= 1 for d in distances):
            candidates.append((sum(d * d for d in distances), other_id, row))
    candidates.sort(key=lambda item: (item[0], item[1]))
    cohort = [row for _, _, row in candidates[:MAX_PEERS]]

    common = {"peer_count": len(cohort), "eligible_count": len(candidates), "method": METHOD,
              "limitations": LIMITATIONS}
    if len(cohort) < MIN_PEERS:
        return {**common, "status": "insufficient_peers", "comparisons": [],
                "message": (f"Only {len(cohort)} close matches were found. At least {MIN_PEERS} are needed; "
                            "no spending suggestions are inferred.")}

    comparisons = []
    for key, label, review in COMPARISONS:
        values = [row[key] for row in cohort if key in row and math.isfinite(row[key]) and row[key] >= 0]
        if len(values) < MIN_PEERS or key not in target or not math.isfinite(target[key]) or target[key] < 0:
            continue
        typical = median(values)
        actual = target[key]
        difference = actual - typical
        comparisons.append({
            "key": key, "label": label, "your_amount": round(actual, 2), "peer_median": round(typical, 2),
            "sample_size": len(values), "above_median": difference > 0.005, "difference": round(difference, 2),
            "pct_above_median": round(difference / typical * 100, 1) if typical > 0 and difference > 0 else None,
            "review": review, "can_sum_with_other_gaps": False,
        })
    return {**common, "status": "ok", "comparisons": comparisons,
            "message": ("Start with areas above the peer median. Review the underlying payments and choose an "
                        "affordable reduction; matching the median is optional.")}
