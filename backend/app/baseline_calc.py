"""Pandas reference implementation of the judges' baseline definitions.

Used in tests to cross-check the SQL views in app/db/schema.py against the raw CSVs.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

COLUMNS = ["account_id", "income", "spending", "household_bills", "fixed_costs", "buffer",
           "months_of_history", "card_withdrawals", "cash_withdrawals", "transfers_out_other",
           "loan_payment"]


def compute_baselines(data_dir: Path) -> pd.DataFrame:
    m = pd.read_csv(data_dir / "monthly_summary.csv")
    loans = pd.read_csv(data_dir / "loans.csv")

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

    running = loans[loans.status.isin(["C", "D"])]        # judges: P counts for status C or D
    out["loan_payment"] = running.groupby("account_id").monthly_payment.sum()
    out["loan_payment"] = out["loan_payment"].fillna(0.0)

    return out.reset_index()[COLUMNS]
