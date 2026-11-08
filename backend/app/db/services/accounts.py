"""Per-account values from account_metrics."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import AccountNotFound, NoHistory
from ..schema import account_metrics as m
from ..types import AccountSnapshot, Baseline, BaselineMetrics, FlexibleSpending
from ._common import build, run

# A row counts as filled once its baseline inputs are present.
_BASELINE_REQUIRED = ("income", "spending", "household_bills", "fixed_costs", "buffer", "months_of_history")


def _filled():
    return [m.c[c].is_not(None) for c in _BASELINE_REQUIRED]


def _row(session: Session, account_id: int) -> Any:
    row = run(session, select(m).where(m.c.account_id == account_id)).mappings().first()
    if row is None:
        raise AccountNotFound(account_id)
    if any(row[c] is None for c in _BASELINE_REQUIRED):
        raise NoHistory(account_id)
    return row


def list_account_ids(session: Session) -> list[int]:
    return list(run(session, select(m.c.account_id).order_by(m.c.account_id)).scalars())


def get_account_snapshot(session: Session, account_id: int) -> AccountSnapshot:
    """Baseline, flexible spending, loan payment and baseline metrics in one query."""
    row = _row(session, account_id)
    return AccountSnapshot(
        account_id=account_id,
        baseline=build(Baseline, row),
        flexible=build(FlexibleSpending, row),
        loan_payment=float(row["loan_payment"] or 0.0),
        metrics=build(BaselineMetrics, row),
    )


def get_account_baseline(session: Session, account_id: int) -> Baseline:
    return build(Baseline, _row(session, account_id))


def get_flexible_spending(session: Session, account_id: int) -> FlexibleSpending:
    return build(FlexibleSpending, _row(session, account_id))


def get_loan_payment(session: Session, account_id: int) -> float:
    """P: the running loan's monthly payment (status C or D), else 0."""
    row = run(session, select(m.c.loan_payment).where(m.c.account_id == account_id)).first()
    if row is None:
        raise AccountNotFound(account_id)
    return float(row.loan_payment or 0.0)


def get_baseline_metrics(session: Session, account_id: int) -> BaselineMetrics:
    row = run(session, select(m).where(m.c.account_id == account_id)).mappings().first()
    if row is None:
        raise AccountNotFound(account_id)
    return build(BaselineMetrics, row)


def get_all_baselines(session: Session) -> dict[int, Baseline]:
    """Every account whose baseline has been filled in."""
    rows = run(session, select(m).where(*_filled()).order_by(m.c.account_id)).mappings()
    return {r["account_id"]: build(Baseline, r) for r in rows}
