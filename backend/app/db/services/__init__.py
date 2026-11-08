"""Fetch-only functions. Each takes a Session first, runs parameterized SELECTs,
returns frozen dataclasses, and raises AccountNotFound for an unknown account."""
from .accounts import (
    get_account_baseline, get_account_snapshot, get_all_baselines, get_baseline_metrics, get_flexible_spending,
    get_loan_payment, get_peer_metrics, list_account_ids,
)

__all__ = [
    "get_account_baseline", "get_account_snapshot", "get_all_baselines", "get_baseline_metrics",
    "get_flexible_spending", "get_loan_payment", "get_peer_metrics", "list_account_ids",
]
