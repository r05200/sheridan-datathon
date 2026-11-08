"""The single module that touches the database (Tiger Data / Postgres).

Read-only, parameterized queries only. If the database is unreachable (or disabled)
we fall back to a local baseline CSV export so the demo still runs.
"""
from __future__ import annotations

import csv
import logging
from functools import lru_cache
from typing import Any

import psycopg2
import psycopg2.extras

from . import config

log = logging.getLogger("tangerine.db")

METRICS_TABLE = "public.account_metrics"  # processed account data in TigerData

BASELINE_FIELDS = [
    "income", "spending", "household_bills", "fixed_costs", "buffer", "months_of_history",
]
FLEX_FIELDS = ["card_withdrawals", "cash_withdrawals", "transfers_out_other"]
EXPORT_COLUMNS = ["account_id", *BASELINE_FIELDS, *FLEX_FIELDS, "loan_payment"]


class AccountNotFound(LookupError):
    def __init__(self, account_id: int):
        super().__init__(f"Account {account_id} not found")
        self.account_id = account_id


class DatabaseUnavailable(RuntimeError):
    """Database unreachable and no offline export available."""


# --------------------------------------------------------------------------- offline
@lru_cache(maxsize=1)
def _offline_rows() -> dict[int, dict[str, float]]:
    path = config.OFFLINE_BASELINE_PATH
    if not path.exists():
        raise DatabaseUnavailable(
            f"Database unreachable and no offline export at {path}. "
            "Run scripts/export_baseline.py while the database (or CSVs) are available."
        )
    with path.open(newline="") as f:
        return {
            int(r["account_id"]): {k: float(r[k]) for k in EXPORT_COLUMNS if k != "account_id"}
            for r in csv.DictReader(f)
        }


def _offline_get(account_id: int) -> dict[str, float]:
    try:
        return _offline_rows()[account_id]
    except KeyError:
        raise AccountNotFound(account_id) from None


# --------------------------------------------------------------------------- online
def _connect():
    return psycopg2.connect(
        config.database_url(),
        connect_timeout=config.DB_CONNECT_TIMEOUT_S,
        options="-c default_transaction_read_only=on",
    )


def _query(sql: str, params: tuple | None = None) -> list[dict[str, Any]]:
    """Run one parameterized read-only query. Raises psycopg2.OperationalError if unreachable."""
    conn = _connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def _run(sql: str, params: tuple | None, offline):
    """Try the database; on connection failure use the offline callable instead."""
    if config.db_disabled():
        return offline()
    try:
        return _query(sql, params)
    except (psycopg2.errors.UndefinedTable, psycopg2.errors.UndefinedColumn) as e:
        raise DatabaseUnavailable(
            "TigerData schema mismatch: expected public.account_metrics with baseline, "
            "spending-breakdown and loan_payment columns. Check DATABASE_URL and the account_metrics import."
        ) from e
    except psycopg2.OperationalError as e:  # unreachable / timeout / auth
        log.warning("Database unreachable (%s); using local export", str(e).strip()[:120])
        return offline()


def _floats(row: dict, keys: list[str]) -> dict[str, float]:
    return {k: float(row[k]) if row[k] is not None else 0.0 for k in keys}


# --------------------------------------------------------------------------- public API
def get_account_baseline(account_id: int) -> dict[str, float]:
    """Typical income, spending, household bills, fixed costs, buffer (+ months of history)."""
    sql = f"SELECT {', '.join(BASELINE_FIELDS)} FROM {METRICS_TABLE} WHERE account_id = %s"
    rows = _run(sql, (account_id,), lambda: [_offline_get(account_id)] if account_id in _offline_rows() else [])
    if not rows:
        raise AccountNotFound(account_id)
    return _floats(rows[0], BASELINE_FIELDS)


def get_loan_payment(account_id: int) -> float:
    """Monthly payment if a loan is still running at end of 2025, else 0."""
    sql = f"SELECT loan_payment FROM {METRICS_TABLE} WHERE account_id = %s"
    rows = _run(sql, (account_id,), lambda: [{"loan_payment": _offline_get(account_id)["loan_payment"]}])
    if not rows:
        raise AccountNotFound(account_id)
    return float(rows[0]["loan_payment"] or 0)


def get_flexible_spending(account_id: int) -> dict[str, float]:
    """Typical monthly card withdrawals, cash withdrawals, other transfers out."""
    sql = f"SELECT {', '.join(FLEX_FIELDS)} FROM {METRICS_TABLE} WHERE account_id = %s"
    rows = _run(sql, (account_id,), lambda: [_offline_get(account_id)] if account_id in _offline_rows() else [])
    if not rows:
        raise AccountNotFound(account_id)
    return _floats(rows[0], FLEX_FIELDS)


def get_all_baselines() -> dict[int, dict[str, float]]:
    """Every account's baseline (all-accounts finding)."""
    sql = f"SELECT account_id, {', '.join(BASELINE_FIELDS)} FROM {METRICS_TABLE}"

    def offline():
        return [{"account_id": i, **v} for i, v in _offline_rows().items()]

    return {int(r["account_id"]): _floats(r, BASELINE_FIELDS) for r in _run(sql, None, offline)}


def _ensure_account_exists(account_id: int) -> None:
    sql = f"SELECT 1 AS ok FROM {METRICS_TABLE} WHERE account_id = %s"
    rows = _run(sql, (account_id,), lambda: [{"ok": 1}] if account_id in _offline_rows() else [])
    if not rows:
        raise AccountNotFound(account_id)


def table_counts() -> dict[str, int]:
    """Check the current TigerData table, without falling back to local CSV data."""
    return {"account_metrics": int(_query(f"SELECT COUNT(*) AS n FROM {METRICS_TABLE}")[0]["n"])}


def get_account_page(page: int, search: str = "", page_size: int = 30) -> tuple[int, list[dict]]:
    """Read only this page's baseline summaries; count uses the same account-ID filter."""
    pattern = f"%{search}%"
    where = " WHERE CAST(account_id AS TEXT) LIKE %s"
    def matching():
        return sorted((i, row) for i, row in _offline_rows().items() if search in str(i))
    total = int(_run(f"SELECT COUNT(*) AS total FROM {METRICS_TABLE}" + where,
                     (pattern,), lambda: [{"total": len(matching())}])[0]["total"])
    offset = (page - 1) * page_size
    rows = _run(f"SELECT account_id, income, spending, buffer FROM {METRICS_TABLE}" + where +
                " ORDER BY account_id LIMIT %s OFFSET %s", (pattern, page_size, offset),
                lambda: [{"account_id": i, **row} for i, row in matching()[offset:offset + page_size]])
    return total, [{"account_id": int(row["account_id"]),
                    **_floats(row, ["income", "spending", "buffer"])} for row in rows]


def get_peer_metrics() -> dict[int, dict[str, float]]:
    """Comparable account-level baselines from TigerData or the local export."""
    fields = [*BASELINE_FIELDS, *FLEX_FIELDS, 'loan_payment']
    rows = _run(f"SELECT account_id, {', '.join(fields)} FROM {METRICS_TABLE}", None,
                lambda: [{"account_id": i, **row} for i,row in _offline_rows().items()])
    return {int(row['account_id']): _floats(row, fields) for row in rows}
