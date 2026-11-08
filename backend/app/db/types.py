"""Frozen dataclasses returned by the services. Money is float."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Baseline:
    """Judges' headline inputs. income/spending/household_bills/fixed_costs are monthly medians;
    buffer is the mean avg_daily_balance over the last 6 months."""
    account_id: int
    income: float
    spending: float
    household_bills: float
    fixed_costs: float
    buffer: float
    months_of_history: int


@dataclass(frozen=True, slots=True)
class FlexibleSpending:
    """Monthly medians of the spending a backup plan can cut."""
    account_id: int
    card_withdrawals: float
    cash_withdrawals: float
    transfers_out_other: float


@dataclass(frozen=True, slots=True)
class BaselineMetrics:
    """Precomputed no-shock values shown on the frontend. Any of them may still be blank (None)."""
    account_id: int
    runway_months: float | None
    has_shortfall: bool | None
    runway_capped: bool | None
    monthly_shortfall: float | None
    monthly_surplus: float | None
    goal_target_months: int | None
    goal_target_amount: float | None
    goal_amount_still_needed: float | None
    goal_progress_pct: float | None
    goal_months_to_goal: float | None


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    """Everything the frontend and plan engine need for one account, from one query."""
    account_id: int
    baseline: Baseline
    flexible: FlexibleSpending
    loan_payment: float
    metrics: BaselineMetrics
