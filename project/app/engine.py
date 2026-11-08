"""Runway, shock, goal plan and backup plan math. All numbers are computed here, never by Gemini.

Output of build_plan() is the Plan Explainer's input JSON (PRD Part 1, proposed contract).
Rounding: dollars to whole numbers, months to 1 decimal. The explainer must reuse these exact values.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any

from . import db
from .timeline import monthly_budgets, assess
from .planning import PlanningOptions, build_action_plan

GOAL_MONTHS_OF_SPENDING = 3
LOW_CONFIDENCE_MONTHS = 24     # < 2 years of history => rougher numbers
NO_SHORTFALL = "no_shortfall"


@dataclass
class OneOffCost:
    label: str = "one-off cost"
    amount_dollars: float | None = None
    multiple_of_monthly_spending: float | None = None


@dataclass
class RecurringCost:
    label: str
    monthly_change: float
    source: str = "user_estimate"
    duration_months: int | None = None


@dataclass
class Shock:
    """Shock values as the sliders hold them (relative values, resolved against the baseline here)."""
    income_multiplier: float | None = None       # 1.0 = unchanged, 0 = no income
    income_duration_months: int | None = None
    household_bills_pct_change: float | None = None
    spending_pct_change: float | None = None
    one_off_costs: list[OneOffCost] = field(default_factory=list)

    recurring_costs: list[RecurringCost] = field(default_factory=list)
    scenario_duration_months: int | None = None
    overlap_acknowledged: bool = False
    effect_durations: dict[str, int] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return (self.income_multiplier is None and self.household_bills_pct_change is None
                and self.spending_pct_change is None and not self.one_off_costs and not self.recurring_costs)


def _money(x: float) -> int:
    return int(round(x))


def _months(x: float) -> float:
    return round(x, 1)


def _num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def runway(buffer: float, income: float, spending: float) -> float | str:
    """Challenge formula: buffer check first, then shortfall, capped at 120."""
    gap = spending - income
    if buffer <= 0:
        return 0
    if gap <= 0:
        return NO_SHORTFALL
    return min(buffer / gap, 120)


def resolve_one_off(c: OneOffCost, spending: float) -> float:
    if c.amount_dollars is not None:
        return c.amount_dollars
    if c.multiple_of_monthly_spending is not None:
        return c.multiple_of_monthly_spending * spending
    return 0.0


def shock_label(s: Shock) -> str:
    if s.is_empty:
        return "No shock"
    parts = []
    if s.income_multiplier is not None:
        pct = _num(round(s.income_multiplier * 100, 1))
        dur = f" for {s.income_duration_months} months" if s.income_duration_months else ""
        parts.append(f"Income at {pct}% of normal{dur}")
    if s.household_bills_pct_change is not None:
        parts.append(f"household bills {s.household_bills_pct_change:+g}%")
    if s.spending_pct_change is not None:
        parts.append(f"spending {s.spending_pct_change:+g}%")
    for c in s.one_off_costs:
        parts.append(f"one-off cost: {c.label}")
    for i,c in enumerate(s.recurring_costs):
        duration=s.effect_durations.get(f"category_{i}",c.duration_months)
        suffix=f" for {duration} months" if duration else ""
        parts.append(f"{c.label} {c.monthly_change:+g}/month{suffix}")
    text = ", ".join(parts)
    return text[0].upper() + text[1:]


def build_plan(baseline: dict[str, float], flexible: dict[str, float], shock: Shock,
               account_id: int | None = None, planning: PlanningOptions | None = None) -> dict[str, Any]:
    income, spending, buffer = baseline["income"], baseline["spending"], baseline["buffer"]
    bills = baseline["household_bills"]

    # --- shock (judges' definitions) ---
    income_after = income * (shock.income_multiplier if shock.income_multiplier is not None else 1.0)
    spending_after = spending
    if shock.household_bills_pct_change is not None:
        spending_after += shock.household_bills_pct_change / 100 * bills
    if shock.spending_pct_change is not None:
        spending_after += shock.spending_pct_change / 100 * spending
    if shock.recurring_costs and shock.spending_pct_change and not shock.overlap_acknowledged:
        raise ValueError("Overall spending and category changes overlap. Confirm how they should combine.")
    if (shock.household_bills_pct_change and not shock.overlap_acknowledged and any(
            any(word in c.label.lower() for word in ("rent", "utilit", "mortgage", "household", "bill"))
            for c in shock.recurring_costs)):
        raise ValueError("Household bills and category changes may overlap; confirm how they combine.")
    for cost in shock.recurring_costs:
        if not math.isfinite(cost.monthly_change):
            raise ValueError("Recurring adjustments must be finite.")
    spending_after += sum(c.monthly_change for c in shock.recurring_costs)
    if spending_after < 0:
        raise ValueError("The requested reductions exceed recorded total spending.")
    one_off_total = sum(resolve_one_off(c, spending) for c in shock.one_off_costs)
    buffer_after = buffer - one_off_total          # one-off costs come out of the buffer

    gap_after = max(0.0, spending_after - income_after)
    base_runway = runway(buffer, income, spending)
    after_runway = runway(buffer_after, income_after, spending_after)

    # An income shock that ends: the savings only need to cover the shock duration.
    duration = shock.scenario_duration_months or shock.income_duration_months
    explicit_durations = list(shock.effect_durations.values()) + [c.duration_months for c in shock.recurring_costs if c.duration_months]
    allowed_keys = {'income', 'bills', 'spending'} | {f'category_{i}' for i in range(len(shock.recurring_costs))}
    if set(shock.effect_durations) - allowed_keys:
        raise ValueError('Unknown recurring change in effect_durations')
    for value in explicit_durations:
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 60:
            raise ValueError('Each effect duration must be a whole number from 1 to 60 months')
    duration = duration or (max(explicit_durations) if explicit_durations else None)
    if explicit_durations and max(explicit_durations) > duration:
        raise ValueError('Assessment period must include every effect duration')
    variable = bool(explicit_durations) or bool(shock.income_duration_months and duration and shock.income_duration_months != duration)
    if shock.income_duration_months and duration and shock.income_duration_months > duration:
        raise ValueError('Assessment period must include the income change duration')
    budgets = monthly_budgets(baseline, shock, duration) if variable and duration else None
    timeline = assess(buffer_after, budgets) if budgets else None
    # Legacy scenarios with no separate durations retain their shared horizon.

    # It is not a forecast of conditions after income replacement ends.
    upfront_gap = max(0.0, -buffer_after)
    required_buffer = one_off_total + duration * gap_after if duration else None
    if timeline:
        required_buffer = one_off_total + timeline['peak_gap']
    funding_gap = max(0.0, required_buffer - buffer) if duration else None

    preferences = planning or PlanningOptions()
    action_plan = build_action_plan(baseline, income_after, spending_after, one_off_total, duration, preferences, monthly_budget=budgets)

    # --- goal plan: emergency fund of N months of spending, funded from baseline surplus ---
    target = action_plan["goal"]["target_amount"]
    capacity = action_plan["goal"]["monthly_contribution"]
    if buffer >= target:
        months_to_goal: float | None = 0
    elif capacity <= 0:
        months_to_goal = None                      # surplus is zero: goal not reachable by saving alone
    else:
        months_to_goal = math.ceil(round((target - buffer) / capacity * 10, 10)) / 10

    # --- backup plan: cut flexible spending so savings last through the shock ---
    horizon = duration if duration else None       # None => permanent: cover the full gap
    if gap_after <= 0:
        cut_needed = 0.0
    elif horizon:
        cut_needed = max(0.0, gap_after - max(buffer_after, 0.0) / horizon)
    else:
        cut_needed = gap_after
    # Whole-dollar recommendations must not round down below the required cut.
    if timeline:
        cut_needed = timeline["improvement"]
    recommended_cut = math.ceil(round(cut_needed, 10))
    # Withdrawal/transfer categories do not identify discretionary purchases.
    # Only confirmed user budgets could establish whether a proposed cut is feasible.
    if upfront_gap > 0 or cut_needed > spending_after:
        cuts_sufficient = False
    elif cut_needed == 0:
        cuts_sufficient = True
    else:
        cuts_sufficient = None

    months_of_history = baseline.get("months_of_history")
    low_conf = months_of_history is not None and months_of_history < LOW_CONFIDENCE_MONTHS
    reason = (f"only {int(months_of_history)} months of history" if low_conf else None)

    def r(v):  # round runway values: keep sentinel string / ints
        return v if isinstance(v, str) else (_months(v) if v is not None else None)

    plan = {
        "account_id": account_id,
        "baseline": {"income": _money(income), "spending": _money(spending), "buffer": _money(buffer),
                     "runway_months": r(base_runway),
                     "runway_capped": spending > income and buffer > 120 * (spending - income)},
        "shock": {"label": shock_label(shock), "duration_months": duration},
        "after_shock": {"income": _money(income_after), "spending": _money(spending_after),
                        "monthly_gap": _money(gap_after), "runway_months": r(after_runway),
                        "buffer": _money(buffer_after),
                        "runway_capped": gap_after > 0 and buffer_after > 120 * gap_after},
        "goal_plan": {"target_months_of_spending": (_months(target / spending) if preferences.target_amount_override is not None and spending > 0 else preferences.target_months), "target_amount": _money(target),
                      "monthly_savings_capacity": _money(capacity), "months_to_goal": r(months_to_goal)},
        "backup_plan": {"monthly_cut_needed": recommended_cut,
                        "flexible_spending": {k: _money(v) for k, v in flexible.items()},
                        "flexible_spending_verified": False,
                        "upfront_funding_needed": math.ceil(round(upfront_gap, 10)),
                        "cuts_sufficient": cuts_sufficient},
        "flags": {"low_confidence": low_conf, "reason": reason},
    }
    if planning is not None:
        plan["action_plan"] = action_plan
    if shock.recurring_costs:
        plan["after_shock"]["recurring_adjustments"] = [
            {"label": c.label, "monthly_change": round(c.monthly_change, 2), "source": c.source}
            for c in shock.recurring_costs
        ]
    if duration:
        plan["duration_assessment"] = {
            "months": duration,
            "required_starting_buffer": math.ceil(round(required_buffer, 10)),
            "additional_buffer_needed": math.ceil(round(funding_gap, 10)),
            "covers_duration": buffer > 0 and funding_gap == 0,
            "ending_buffer": _money(timeline["ending"] if timeline else buffer_after + duration * (income_after - spending_after)),
            "assumption": ("Each change ends after its selected duration and returns to the normal baseline. All changes start in month 1; one-off costs are paid upfront." if timeline else "All supplied shocks remain in effect over this assessment window."),
        }
    if timeline:
        plan['monthly_projection'] = timeline['rows']
        plan['shock']['effect_durations'] = {**shock.effect_durations,
            **{f'category_{i}': c.duration_months for i,c in enumerate(shock.recurring_costs) if c.duration_months and f'category_{i}' not in shock.effect_durations}}
        plan['duration_assessment']['covers_duration'] = timeline['covered']
        plan['duration_assessment']['minimum_buffer'] = round(timeline['minimum'],2)
        plan['after_shock']['runway_basis'] = 'Month-one spending and income held constant; see monthly projection for temporary changes.'
    if one_off_total:
        plan["after_shock"]["one_off_costs"] = _money(one_off_total)
        plan["after_shock"]["buffer"] = _money(buffer_after)
    return plan


def plan_for_account(account_id: int, shock: Shock, planning: PlanningOptions | None = None) -> dict[str, Any]:
    return build_plan(db.get_account_baseline(account_id), db.get_flexible_spending(account_id),
                      shock, account_id, planning)
