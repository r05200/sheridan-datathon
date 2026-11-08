"""Database schema: only what the frontend displays.

One row per account in `account_metrics`. scripts/setup_db.py creates the table and
leaves it empty; the values are filled in later (from the competition CSVs, using the
judges' definitions). Everything shock-dependent is computed per request by the plan
engine and is not stored.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, Float, Integer, MetaData, Table

metadata = MetaData()

account_metrics = Table(
    "account_metrics", metadata,
    Column("account_id", Integer, primary_key=True, autoincrement=False),   # account list / search

    # "Your starting point" boxes (monthly medians unless noted)
    Column("income", Float),                    # Monthly inflows: median money_in
    Column("spending", Float),                  # Monthly spending: median money_out
    Column("household_bills", Float),           # Household bills: median household_bills
    Column("fixed_costs", Float),               # Fixed costs: median(bills + insurance + loan_payments)
    Column("buffer", Float),                    # Savings buffer: mean avg_daily_balance, last 6 months
    Column("runway_months", Float),             # Baseline runway: min(buffer / gap, 120), 1 decimal;
                                                #   0 if buffer <= 0; NULL when there is no shortfall
    Column("has_shortfall", Boolean),           # false => "No shortfall"
    Column("runway_capped", Boolean),           # true => "Capped at 120 months"

    # Account line under the account box
    Column("months_of_history", Integer),       # "N observed months"
    Column("loan_payment", Float),              # "Active loan payment": status C or D, else 0

    # "Explore the full account baseline" panel (flexible spending)
    Column("card_withdrawals", Float),
    Column("cash_withdrawals", Float),
    Column("transfers_out_other", Float),

    # Before/after table, "before" column
    Column("monthly_shortfall", Float),         # max(spending - income, 0)

    # Goal plan boxes at the default target (3 months of spending)
    Column("goal_target_months", Integer),      # 3
    Column("goal_target_amount", Float),        # "Emergency-fund target" / "Target buffer"
    Column("goal_amount_still_needed", Float),  # "Still to build"
    Column("monthly_surplus", Float),           # "Available monthly surplus": max(income - spending, 0)
    Column("goal_progress_pct", Float),         # progress bar: buffer / target * 100, capped at 100
    Column("goal_months_to_goal", Float),       # "Time to goal": 0 if funded; NULL if not reachable
)
