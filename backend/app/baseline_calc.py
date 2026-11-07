"""Pandas reference implementation of the judges' baseline definitions.

Used to build the offline export and to cross-check the SQL view in tests.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from .db import EXPORT_COLUMNS

LOAN_CUTOFF = pd.Timestamp("2025-12-31")


def compute_baselines(data_dir: Path) -> pd.DataFrame:
    m = pd.read_csv(data_dir / "monthly_summary.csv")
    loans = pd.read_csv(data_dir / "loans.csv", parse_dates=["loan_start"])

    m["fixed"] = m.household_bills + m.insurance + m.loan_payments
    g = m.groupby("account_id")
    out = pd.DataFrame({
        "income": g.money_in.median(),
        "spending": g.money_out.median(),
        "household_bills": g.household_bills.median(),
        "fixed_costs": g.fixed.median(),
        "card_withdrawals": g.card_withdrawals.median(),
        "cash_withdrawals": g.cash_withdrawals_genuine.median(),
        "transfers_out_other": g.transfers_out_other.median(),
        "months_of_history": g.size(),
    })
    last6 = m.sort_values("month").groupby("account_id").tail(6)
    out["buffer"] = last6.groupby("account_id").avg_daily_balance.mean()

    end = loans.apply(lambda r: r.loan_start + pd.DateOffset(months=int(r.duration_months)), axis=1)
    running = loans[end > LOAN_CUTOFF]
    out["loan_payment"] = running.groupby("account_id").monthly_payment.sum()
    out["loan_payment"] = out["loan_payment"].fillna(0.0)

    out = out.reset_index()
    return out[EXPORT_COLUMNS]
