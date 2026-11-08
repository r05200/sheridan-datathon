"""Transparent account diagnostics derived from the bundled challenge CSVs."""
from __future__ import annotations

import csv
import json
import math
import os
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import config

PROFILE_PATH = config.BACKEND_DIR / "data" / "customer_profiles.csv"
DATA_DIR = Path(os.environ.get("TANGERINE_DATA_DIR", config.BACKEND_DIR.parent / "data"))
MONTHLY_PATH = DATA_DIR / "monthly_summary.csv"
LOANS_PATH = DATA_DIR / "loans.csv"
SPOTLIGHT_PATH = config.BACKEND_DIR / "data" / "spotlight_accounts.json"
SPOTLIGHTS = {
    38346: ("Healthy running loan", "Running loan with no historical negative-balance month."),
    93088: ("Defaulted/debt loan; formula says no shortfall", "Status D loan and prior negative-balance months, despite a no-shortfall baseline formula."),
    90553: ("No loan; prior negative balances", "No loan record and prior negative-balance months, despite a no-shortfall baseline formula."),
}
FILTERS = {
    "all": "All accounts",
    "troubled_loans_healthy": "Defaulted/debt loan and formula says no shortfall",
    "no_loan_negative": "No loan and a prior negative-balance month",
    "negative": "Any prior negative-balance month",
    "watchlist": "Never-negative watchlist",
}


class InsightsUnavailable(RuntimeError):
    """Required bundled source data is missing or invalid."""


def _number(row: dict[str, str], key: str) -> float:
    try:
        value = float(row[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise InsightsUnavailable(f"Missing or invalid {key!r} in bundled account data") from exc
    if not math.isfinite(value):
        raise InsightsUnavailable(f"Non-finite {key!r} in bundled account data")
    return value


def _bool(row: dict[str, str], key: str) -> bool:
    return row.get(key, "").strip().lower() in {"1", "true", "yes"}


def _quantile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise InsightsUnavailable("Cannot calculate income bands without account profiles")
    pos = (len(ordered) - 1) * p
    low, high = math.floor(pos), math.ceil(pos)
    return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)


def _low_value_risk_percentiles(values: list[float]) -> list[float]:
    """Midrank percentile where a lower raw value means higher watchlist priority."""
    order = sorted(range(len(values)), key=lambda index: (values[index], index))
    result = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        raw_percentile = ((start + end - 1) / 2 + 1) / len(values)
        risk_percentile = 1.0 - raw_percentile
        for position in range(start, end):
            result[order[position]] = risk_percentile
        start = end
    return result


def _watchlist_rank(rows: list[dict[str, Any]]) -> None:
    eligible = [row for row in rows if not row["past_negative_month"]]
    if not eligible:
        return
    components = [
        _low_value_risk_percentiles([row["latest_balance"] for row in eligible]),
        _low_value_risk_percentiles([row["recent_surplus_3m"] for row in eligible]),
        _low_value_risk_percentiles([row["balance_slope_3m"] for row in eligible]),
    ]
    for index, row in enumerate(eligible):
        row["_priority"] = sum(part[index] for part in components) / len(components)
    eligible.sort(key=lambda row: (-row["_priority"], row["account_id"]))
    count = len(eligible)
    priority_count = math.ceil(count * 0.05)
    watch_count = math.ceil(count * 0.20)
    for rank, row in enumerate(eligible, start=1):
        row["watchlist_rank"] = rank
        row["watchlist_band"] = (
            "Priority" if rank <= priority_count else
            "Watch" if rank <= watch_count else
            "Routine"
        )
        row.pop("_priority", None)
    for row in rows:
        if row["past_negative_month"]:
            row["watchlist_rank"] = None
            row["watchlist_band"] = None


def _history_signals(history: list[dict[str, Any]]) -> dict[str, Any]:
    if not history:
        raise InsightsUnavailable("An account has no monthly history")
    last3 = history[-3:]
    prior3 = history[-6:-3]
    # Match the median convention used by the profile for even-length histories.
    incomes = sorted(row["money_in"] for row in history)
    income_median = (
        incomes[len(incomes) // 2] if len(incomes) % 2
        else (incomes[len(incomes) // 2 - 1] + incomes[len(incomes) // 2]) / 2
    )
    recent_income = _median(row["money_in"] for row in last3)
    income_ratio = recent_income / income_median if income_median else None
    balance_slope = None
    if prior3:
        balance_slope = (
            sum(row["month_end_balance"] for row in last3) / len(last3)
            - sum(row["month_end_balance"] for row in prior3) / len(prior3)
        )
    return {
        "latest_month": history[-1]["month"],
        "latest_balance": history[-1]["month_end_balance"],
        "negative_month_count": sum(row["days_below_zero"] > 0 for row in history),
        "worst_observed_balance": min(row["min_balance"] for row in history),
        "cash_withdrawal_share": (
            sum(row["cash_withdrawals"] for row in history)
            / sum(row["money_out"] for row in history)
            if sum(row["money_out"] for row in history) > 0 else None
        ),
        "median_observed_loan_payment": _median(row["loan_payments"] for row in history),
        "recent_income_median_3m": recent_income,
        "official_income_median": income_median,
        "recent_income_ratio": income_ratio,
        "income_median_overstates_recent": income_ratio is not None and income_ratio < 0.8,
        "income_warning_threshold": 0.8,
        "balance_slope_3m": balance_slope,
        "balance_falling": balance_slope is not None and balance_slope < 0,
        "recent_surplus_3m": sum(row["money_in"] - row["money_out"] for row in last3) / len(last3),
    }


def _median(values) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _load_inputs() -> tuple[dict[int, dict[str, str]], dict[int, list[dict[str, Any]]]]:
    if not PROFILE_PATH.exists():
        raise InsightsUnavailable(f"Required account profile file is missing: {PROFILE_PATH}")
    if not MONTHLY_PATH.exists():
        raise InsightsUnavailable(f"Required monthly history file is missing: {MONTHLY_PATH}")
    if not LOANS_PATH.exists():
        raise InsightsUnavailable(f"Required loan snapshot file is missing: {LOANS_PATH}")
    with PROFILE_PATH.open(newline="", encoding="utf-8-sig") as stream:
        profiles = {int(row["account_id"]): row for row in csv.DictReader(stream)}
    with LOANS_PATH.open(newline="", encoding="utf-8-sig") as stream:
        loans = {
            int(row["account_id"]): {
                "status": row["status"],
                "monthly_payment": float(row["monthly_payment"]),
            }
            for row in csv.DictReader(stream)
        }
    history: dict[int, list[dict[str, Any]]] = defaultdict(list)
    required = (
        "account_id", "month", "money_in", "money_out", "loan_payments",
        "cash_withdrawals_genuine", "month_end_balance", "min_balance", "days_below_zero",
    )
    with MONTHLY_PATH.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = set(required) - set(reader.fieldnames or [])
        if missing:
            raise InsightsUnavailable(f"Monthly history is missing columns: {', '.join(sorted(missing))}")
        for raw in reader:
            account_id = int(raw["account_id"])
            history[account_id].append({
                "month": raw["month"],
                "money_in": float(raw["money_in"]),
                "money_out": float(raw["money_out"]),
                "loan_payments": float(raw["loan_payments"]),
                "cash_withdrawals": float(raw["cash_withdrawals_genuine"]),
                "month_end_balance": float(raw["month_end_balance"]),
                "min_balance": float(raw["min_balance"]),
                "days_below_zero": float(raw["days_below_zero"]),
            })
    for rows in history.values():
        rows.sort(key=lambda row: row["month"])
    if len(profiles) != 4500:
        raise InsightsUnavailable(f"Expected 4,500 bundled account profiles, found {len(profiles)}")
    if set(profiles) != set(history):
        raise InsightsUnavailable("Profile and monthly-history account IDs do not match")
    return profiles, history, loans


def _build_watchlist_validation(histories: dict[int, list[dict[str, Any]]]) -> dict[str, Any]:
    months = sorted({row["month"] for rows in histories.values() for row in rows})
    if len(months) < 7:
        raise InsightsUnavailable("At least seven distinct months are needed to validate watchlist ranking")
    cutoff = months[-7]
    future_months = months[-6:]
    candidates = []
    for account_id, rows in histories.items():
        before = [row for row in rows if row["month"] <= cutoff]
        after = [row for row in rows if cutoff < row["month"] <= future_months[-1]]
        if len(before) < 6 or {row["month"] for row in after} != set(future_months):
            continue
        if any(row["days_below_zero"] > 0 for row in before):
            continue
        last3, prior3 = before[-3:], before[-6:-3]
        candidates.append({
            "account_id": account_id,
            "latest_balance": before[-1]["month_end_balance"],
            "recent_surplus_3m": sum(row["money_in"] - row["money_out"] for row in last3) / 3,
            "balance_slope_3m": (
                sum(row["month_end_balance"] for row in last3) / 3
                - sum(row["month_end_balance"] for row in prior3) / 3
            ),
            "event": any(row["days_below_zero"] > 0 for row in after),
        })
    if not candidates:
        raise InsightsUnavailable("No eligible accounts for the retrospective watchlist check")
    component_ranks = [
        _low_value_risk_percentiles([row[field] for row in candidates])
        for field in ("latest_balance", "recent_surplus_3m", "balance_slope_3m")
    ]
    composite = [sum(component[i] for component in component_ranks) / 3 for i in range(len(candidates))]
    surplus = component_ranks[1]
    size = max(1, math.ceil(len(candidates) * 0.05))
    composite_top = sorted(range(len(candidates)), key=lambda i: (-composite[i], candidates[i]["account_id"]))[:size]
    surplus_top = sorted(range(len(candidates)), key=lambda i: (-surplus[i], candidates[i]["account_id"]))[:size]
    events = sum(row["event"] for row in candidates)
    composite_hits = sum(candidates[i]["event"] for i in composite_top)
    surplus_hits = sum(candidates[i]["event"] for i in surplus_top)
    return {
        "cutoff": cutoff,
        "outcome_window": [future_months[0], future_months[-1]],
        "eligible_accounts": len(candidates),
        "later_event_accounts": events,
        "priority_band_size": size,
        "priority_band_events": composite_hits,
        "priority_band_hit_rate": composite_hits / size,
        "later_events_captured_pct": composite_hits / events if events else None,
        "lowest_surplus_same_size_events": surplus_hits,
        "lowest_surplus_same_size_hit_rate": surplus_hits / size,
        "rule": "Equal-weight midrank of low latest balance, low recent 3-month surplus, and falling 3-month balance. Retrospective ranking, not a probability.",
        "warning": "One six-month holdout only. Most later events are not in the top 5% band.",
    }


@lru_cache(maxsize=1)
def _dataset() -> dict[str, Any]:
    profiles, histories, loans = _load_inputs()
    incomes = [_number(row, "typical_monthly_money_in") for row in profiles.values()]
    quartiles = [_quantile(incomes, p) for p in (0.25, 0.5, 0.75)]
    raw: dict[int, dict[str, Any]] = {}
    for account_id, profile in profiles.items():
        history = histories[account_id]
        signals = _history_signals(history)
        raw[account_id] = {
            "account_id": account_id,
            "income": _number(profile, "typical_monthly_money_in"),
            "spending": _number(profile, "typical_monthly_spending"),
            "buffer": _number(profile, "savings_buffer"),
            "runway_months": _number(profile, "baseline_runway_months"),
            "runway_status": profile["baseline_runway_status"],
            "runway_capped": _bool(profile, "baseline_runway_capped"),
            "past_negative_month": _bool(profile, "past_negative_month"),
            "loan_status": profile.get("loan_status", ""),
            "pension_majority": _bool(profile, "pension_majority"),
            "loan_contract_monthly_payment": loans.get(account_id, {}).get("monthly_payment", 0.0),
            "active_loan_monthly_payment": _number(profile, "active_loan_monthly_payment"),
            "history_months": int(_number(profile, "months_observed")),
            "income_quartile": 1 + sum(
                _number(profile, "typical_monthly_money_in") > boundary for boundary in quartiles
            ),
            **signals,
        }
    rows = list(raw.values())
    _watchlist_rank(rows)
    by_id = {row["account_id"]: row for row in rows}

    peer_groups: dict[tuple[int, bool], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        peer_groups[(row["income_quartile"], row["pension_majority"])].append(row)
    for row in rows:
        group = peer_groups[(row["income_quartile"], row["pension_majority"])]
        lower = sum(item["runway_months"] < row["runway_months"] for item in group)
        tied = sum(item["runway_months"] == row["runway_months"] for item in group)
        row["peer_context"] = {
            "income_quartile": row["income_quartile"],
            "income_band": f"Income quartile {row['income_quartile']}",
            "pension_majority": row["pension_majority"],
            "peer_count": len(group),
            "runway_percentile": round(100 * (lower + 0.5 * tied) / len(group), 1),
            "peer_capped_share": round(
                100 * sum(item["runway_months"] >= 120 for item in group) / len(group), 1
            ),
            "interpretation": "Higher percentile means longer official runway within this income/pension peer band. Runway is capped at 120 months.",
        }
    active_statuses = {"C", "D"}
    trouble_count = sum(
        row["loan_status"] in {"B", "D"} and row["runway_status"] == "no_shortfall"
        for row in rows
    )
    no_loan_negative_count = sum(not row["loan_status"] and row["past_negative_month"] for row in rows)
    pension_count = sum(row["pension_majority"] for row in rows)
    validation = _build_watchlist_validation(histories)
    return {
        "by_id": by_id,
        "rows": rows,
        "histories": histories,
        "summary": {
            "account_count": len(rows),
            "troubled_loan_no_shortfall_count": trouble_count,
            "no_loan_prior_negative_count": no_loan_negative_count,
            "pension_majority_count": pension_count,
            "never_negative_count": sum(not row["past_negative_month"] for row in rows),
            "loan_payment_statuses": sorted(active_statuses),
        },
        "watchlist_validation": validation,
        "as_of": max(rows, key=lambda row: row["latest_month"])["latest_month"],
    }


def account_insights(account_id: int) -> dict[str, Any]:
    data = _dataset()
    row = data["by_id"].get(int(account_id))
    if row is None:
        raise KeyError(account_id)
    profile = data["by_id"][int(account_id)]
    history_rows = data["histories"][int(account_id)]
    return {
        "stress": {
            "negative_month_count": profile["negative_month_count"],
            "worst_observed_balance": round(profile["worst_observed_balance"], 2),
            "cash_withdrawal_share": (
                round(profile["cash_withdrawal_share"], 4)
                if profile["cash_withdrawal_share"] is not None else None
            ),
            "loan_status": profile["loan_status"],
            "loan_status_meaning": _loan_status_meaning(profile["loan_status"]),
            "loan_is_running": profile["loan_status"] in {"C", "D"},
            "loan_contract_monthly_payment": round(profile["loan_contract_monthly_payment"], 2),
            "active_loan_monthly_payment": round(profile["active_loan_monthly_payment"], 2),
            "median_observed_loan_payment": round(profile["median_observed_loan_payment"], 2),
            "loan_payment_note": "Contractual amount is from the loan snapshot; median observed payment is across the full monthly history and can be zero when payments are intermittent.",
            "last_month": profile["latest_month"],
            "income_trend": {
                "recent_3_month_median": round(profile["recent_income_median_3m"], 2),
                "official_full_history_median": round(profile["official_income_median"], 2),
                "recent_to_typical_ratio": round(profile["recent_income_ratio"], 4)
                    if profile["recent_income_ratio"] is not None else None,
                "median_overstates_recent": profile["income_median_overstates_recent"],
                "flag_threshold_ratio": profile["income_warning_threshold"],
                "label": "Official median overstates recent income by at least 20%"
                    if profile["income_median_overstates_recent"] else "No 20% recent-inflow warning",
            },
            "balance_trend": {
                "recent_vs_prior_3_month_mean_change": round(profile["balance_slope_3m"], 2)
                    if profile["balance_slope_3m"] is not None else None,
                "falling": profile["balance_falling"],
                "label": "Recent balance is falling" if profile["balance_falling"] else "No falling-balance signal",
            },
            "data_note": "Relabelled PKDD'99 Berka history; district attributes are Czech, not Canadian. Groceries are not recorded, and category budgets and one-off prices are user-supplied. Cash withdrawals are not assumed discretionary. Negative months and worst balance are historical.",
            "observations": len(history_rows),
            "monthly_history": [
                {
                    "month": item["month"],
                    "money_in": round(item["money_in"], 2),
                    "money_out": round(item["money_out"], 2),
                    "month_end_balance": round(item["month_end_balance"], 2),
                }
                for item in history_rows[-12:]
            ],
        },
        "peer_context": profile["peer_context"],
        "pension_check": {
            "pension_majority": profile["pension_majority"],
            "official_baseline_runway_months": profile["runway_months"],
            "official_baseline_runway_status": profile["runway_status"],
            "ei55_runway_months": _number(
                _dataset_profile_row(int(account_id)), "ei55_runway_months"
            ),
            "ei55_runway_status": _dataset_profile_row(int(account_id))["ei55_runway_status"],
            "interpretation": "EI does not apply to pension income; it is an employment benefit. The EI-55% result is only a labelled comparison."
                if profile["pension_majority"] else None,
        } if profile["pension_majority"] else None,
        "watchlist": {
            "eligible": not profile["past_negative_month"],
            "rank": profile["watchlist_rank"],
            "band": profile["watchlist_band"],
            "eligible_accounts": data["summary"]["never_negative_count"],
            "method": "Rules-based relative ranking; not a probability."
                if profile["watchlist_band"] else None,
            "validation": data["watchlist_validation"],
        },
    }


def _dataset_profile_row(account_id: int) -> dict[str, str]:
    # Read the one small static profile file once, alongside the computed dataset.
    return _profile_rows()[account_id]


@lru_cache(maxsize=1)
def _profile_rows() -> dict[int, dict[str, str]]:
    if not PROFILE_PATH.exists():
        raise InsightsUnavailable(f"Required account profile file is missing: {PROFILE_PATH}")
    with PROFILE_PATH.open(newline="", encoding="utf-8-sig") as stream:
        return {int(row["account_id"]): row for row in csv.DictReader(stream)}


def _loan_status_meaning(status: str) -> str:
    return {
        "A": "Finished, repaid",
        "B": "Finished, not repaid (default)",
        "C": "Running, OK so far",
        "D": "Running, client in debt",
    }.get(status, "No loan record")


def account_directory(filter_name: str = "all") -> dict[str, Any]:
    if filter_name not in FILTERS:
        raise ValueError(f"Unknown account filter. Choose one of: {', '.join(FILTERS)}")
    data = _dataset()
    matched = []
    for row in data["rows"]:
        loan_status = row["loan_status"]
        troubled_healthy = loan_status in {"B", "D"} and row["runway_status"] == "no_shortfall"
        no_loan_negative = not loan_status and row["past_negative_month"]
        include = {
            "all": True,
            "troubled_loans_healthy": troubled_healthy,
            "no_loan_negative": no_loan_negative,
            "negative": row["past_negative_month"],
            "watchlist": not row["past_negative_month"],
        }[filter_name]
        if not include:
            continue
        matched.append({
            "account_id": row["account_id"],
            "runway_months": row["runway_months"],
            "runway_status": row["runway_status"],
            "runway_capped": row["runway_capped"],
            "past_negative_month": row["past_negative_month"],
            "loan_status": loan_status,
            "loan_status_meaning": _loan_status_meaning(loan_status),
            "pension_majority": row["pension_majority"],
            "watchlist_rank": row["watchlist_rank"],
            "watchlist_band": row["watchlist_band"],
            "latest_balance": round(row["latest_balance"], 2),
        })
    matched.sort(key=lambda row: row["account_id"])
    return {
        "as_of": data["as_of"],
        "filter": filter_name,
        "filter_label": FILTERS[filter_name],
        "total_accounts": data["summary"]["account_count"],
        "matched_accounts": len(matched),
        "cohort_counts": data["summary"],
        "watchlist_validation": data["watchlist_validation"],
        "caveats": caveats(),
        "accounts": matched,
    }


def spotlight_snapshots() -> dict[str, Any]:
    if not SPOTLIGHT_PATH.exists():
        raise InsightsUnavailable(f"Frozen spotlight data is missing: {SPOTLIGHT_PATH}")
    try:
        with SPOTLIGHT_PATH.open(encoding="utf-8") as stream:
            payload = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise InsightsUnavailable("Frozen spotlight data is unreadable") from exc
    return payload


def build_spotlight_snapshots() -> dict[str, Any]:
    data = _dataset()
    accounts = []
    for account_id, (label, reason) in SPOTLIGHTS.items():
        row = data["by_id"][account_id]
        profile = _dataset_profile_row(account_id)
        accounts.append({
            "account_id": account_id,
            "label": label,
            "reason": reason,
            "baseline": {
                "income": _number(profile, "typical_monthly_money_in"),
                "spending": _number(profile, "typical_monthly_spending"),
                "household_bills": _number(profile, "typical_household_bills"),
                "fixed_costs": _number(profile, "typical_fixed_costs"),
                "buffer": _number(profile, "savings_buffer"),
                "runway_months": _number(profile, "baseline_runway_months"),
                "runway_status": profile["baseline_runway_status"],
                "runway_capped": _bool(profile, "baseline_runway_capped"),
                "months_of_history": int(_number(profile, "months_observed")),
                "loan_contract_monthly_payment": row["loan_contract_monthly_payment"],
            },
            **account_insights(account_id),
        })
    return {
        "as_of": data["as_of"],
        "source": "Bundled challenge CSV snapshots; no live database or Gemini required.",
        "accounts": accounts,
        "caveats": caveats(),
    }


def write_spotlight_snapshots() -> Path:
    payload = build_spotlight_snapshots()
    SPOTLIGHT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return SPOTLIGHT_PATH


def caveats() -> list[str]:
    return [
        "Relabelled PKDD'99 Berka financial data; district attributes describe Czech districts, not Canadian places.",
        "Recorded inflows are not verified salary; average daily balance is a challenge-defined buffer proxy.",
        "Groceries are not a recorded column. Category budgets and one-off prices must come from the user.",
        "The watchlist is a relative, rules-based sort for accounts with no observed negative-balance month; it is not a probability and misses most later events.",
        "Historical negative months and worst balances are observations, not forecasts or financial advice.",
    ]
