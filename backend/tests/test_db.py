"""Database layer tests.

Config, error mapping and the DDL run everywhere.
Service tests need TEST_DATABASE_URL (see conftest.py) and skip without it.
"""
from dataclasses import fields

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.baseline_calc import compute_baselines
from app.db import (
    AccountNotFound, DatabaseUnavailable, NoHistory, build_engine, load_config, services, session_scope,
)
from app.db.config import build_url
from app.db.schema import account_metrics
from conftest import load_setup_db

KNOWN = 20111          # hand-checked: 38 months, running loan (status D) of 2330.19
METRIC_COLUMNS = ("runway_months", "has_shortfall", "runway_capped", "monthly_shortfall", "monthly_surplus",
                  "goal_target_months", "goal_target_amount", "goal_amount_still_needed",
                  "goal_progress_pct", "goal_months_to_goal")
UNKNOWN = 1


# --------------------------------------------------------------------------- config (no database)
def test_config_dict_defaults_to_sslmode_require():
    url = build_url({"host": "h", "user": "u", "password": "p", "dbname": "d"})
    assert url.drivername == "postgresql+psycopg2"
    assert (url.host, url.port, url.database, url.query["sslmode"]) == ("h", 5432, "d", "require")


def test_config_url_gets_driver_and_keeps_explicit_sslmode():
    assert build_url({"url": "postgres://u:p@h:1/d"}).query["sslmode"] == "require"
    url = build_url({"url": "postgresql://u:p@h:1/d?sslmode=disable"})
    assert url.drivername == "postgresql+psycopg2" and url.query["sslmode"] == "disable"


def test_placeholder_url_is_database_unavailable_not_valueerror():
    with pytest.raises(DatabaseUnavailable, match="Invalid database URL"):
        build_url({"url": "postgres://user:password@host:port/dbname?sslmode=require"})


def test_config_missing_fields_is_unavailable():
    with pytest.raises(DatabaseUnavailable, match="host"):
        build_url({"user": "u", "dbname": "d"})


def test_load_config_env_then_json(monkeypatch, tmp_path):
    cfg = tmp_path / "db.json"
    cfg.write_text('{"host": "h", "user": "u", "dbname": "d"}')
    monkeypatch.setenv("DB_CONFIG_PATH", str(cfg))
    assert load_config()["host"] == "h"
    monkeypatch.setenv("DATABASE_URL", "postgresql://x@y/z")
    assert load_config() == {"url": "postgresql://x@y/z"}


def test_no_config_is_database_unavailable(no_database):
    with pytest.raises(DatabaseUnavailable, match="not configured"):
        with session_scope():
            pass


def test_engine_sets_timeouts_and_read_only(monkeypatch):
    from app.db import config as db_config
    calls = []
    monkeypatch.setattr(db_config, "create_engine", lambda url, **kw: calls.append(kw))
    build_engine({"url": "postgresql://u@h/d"})
    build_engine({"url": "postgresql://u@h/d"}, read_only=False, statement_timeout_ms=0)
    app_args, setup_args = (c["connect_args"] for c in calls)
    assert app_args["connect_timeout"] == setup_args["connect_timeout"] == 5
    assert app_args["options"] == "-c statement_timeout=5000 -c default_transaction_read_only=on"
    assert setup_args["options"] == "-c statement_timeout=0"


def test_unreachable_database_raises_database_unavailable():
    eng = build_engine({"url": "postgresql://u:p@127.0.0.1:1/none?sslmode=disable"})
    with Session(eng) as s, pytest.raises(DatabaseUnavailable):
        services.get_account_baseline(s, KNOWN)
    eng.dispose()


# --------------------------------------------------------------------------- schema / setup script
def test_schema_is_only_the_frontend_table():
    from app.db.schema import metadata
    assert list(metadata.tables) == ["account_metrics"]
    cols = {c.name for c in account_metrics.columns}
    assert {"income", "spending", "household_bills", "fixed_costs", "buffer", "months_of_history",
            "loan_payment", "card_withdrawals", "cash_withdrawals", "transfers_out_other",
            *METRIC_COLUMNS} == cols - {"account_id"}
    assert all(c.nullable for c in account_metrics.columns if c.name != "account_id")


def test_ddl_prints_without_a_database():
    out = load_setup_db().ddl()
    assert out.startswith("CREATE TABLE account_metrics") and "goal_months_to_goal FLOAT" in out


def test_load_fills_every_account(writer_engine):
    with writer_engine.connect() as c:
        n, nulls = c.execute(text(
            "SELECT COUNT(*), COUNT(*) - COUNT(income) FROM account_metrics")).one()
    assert (n, nulls) == (4500, 0)


def test_load_is_rerunnable_and_atomic(writer_engine, data_dir):
    from app.account_metrics import compute_account_metrics
    setup = load_setup_db()
    rows = compute_account_metrics(data_dir)
    assert setup.load(writer_engine, rows) == 4500                      # re-run replaces, not appends
    bad = [*rows[:10], {**rows[10], "income": "not a number"}]
    with pytest.raises(Exception):
        setup.load(writer_engine, bad)                                  # failure leaves the old rows
    with writer_engine.connect() as c:
        assert c.execute(select(func.count()).select_from(account_metrics)).scalar_one() == 4500


def test_schema_drift_is_reported(writer_engine):
    setup = load_setup_db()
    assert setup.schema_drift(writer_engine) == []
    with writer_engine.begin() as c:
        c.execute(text("ALTER TABLE account_metrics ADD COLUMN junk integer"))
    try:
        assert setup.schema_drift(writer_engine) == ["extra in database: junk"]
        with pytest.raises(SystemExit, match="--reset"):
            setup.load(writer_engine, [])
    finally:
        with writer_engine.begin() as c:
            c.execute(text("ALTER TABLE account_metrics DROP COLUMN junk"))


# --------------------------------------------------------------------------- services (Postgres)
def test_known_account_snapshot(session):
    snap = services.get_account_snapshot(session, KNOWN)
    assert snap.account_id == KNOWN
    assert snap.baseline.income == pytest.approx(6339.39)
    assert snap.baseline.months_of_history == 38
    assert snap.loan_payment == pytest.approx(2330.19)
    assert services.get_account_baseline(session, KNOWN) == snap.baseline
    assert services.get_flexible_spending(session, KNOWN) == snap.flexible
    assert services.get_loan_payment(session, KNOWN) == snap.loan_payment
    assert services.get_baseline_metrics(session, KNOWN) == snap.metrics


def test_known_account_metrics(session):
    m = services.get_baseline_metrics(session, KNOWN)
    assert m.has_shortfall is True and m.runway_capped is False
    assert m.runway_months == pytest.approx(7.8)                        # 17,611.86 / (8,599.61 - 6,339.39)
    assert m.monthly_shortfall == pytest.approx(2260.215)
    assert m.goal_target_months == 3 and m.goal_months_to_goal is None  # no surplus: not reachable by saving
    assert m.goal_progress_pct == pytest.approx(68.3)


def test_snapshot_is_one_round_trip(session, db_engine):
    statements = []
    listener = lambda *a: statements.append(a[2])  # noqa: E731
    event.listen(db_engine, "before_cursor_execute", listener)
    try:
        services.get_account_snapshot(session, KNOWN)
    finally:
        event.remove(db_engine, "before_cursor_execute", listener)
    assert len(statements) == 1


def test_money_fields_are_float(session):
    snap = services.get_account_snapshot(session, KNOWN)
    for obj in (snap.baseline, snap.flexible):
        for f in fields(obj):
            assert isinstance(getattr(obj, f.name), (int, float)), f.name


@pytest.mark.parametrize("fn", [
    services.get_account_snapshot, services.get_account_baseline, services.get_flexible_spending,
    services.get_loan_payment, services.get_baseline_metrics,
])
def test_unknown_account_raises_account_not_found(session, fn):
    with pytest.raises(AccountNotFound):
        fn(session, UNKNOWN)


def test_account_row_not_filled_yet_raises_no_history(writer_engine):
    """A row with only an account_id (the state before data is filled) is listed but has no baseline."""
    with Session(writer_engine) as s:
        s.execute(account_metrics.insert().values(account_id=UNKNOWN))
        assert UNKNOWN in services.list_account_ids(s)
        assert UNKNOWN not in services.get_all_baselines(s)
        assert services.get_loan_payment(s, UNKNOWN) == 0
        assert services.get_baseline_metrics(s, UNKNOWN).runway_months is None   # bare row: nothing filled
        for fn in (services.get_account_snapshot, services.get_account_baseline, services.get_flexible_spending):
            with pytest.raises(NoHistory):
                fn(s, UNKNOWN)
        s.rollback()


def test_list_account_ids_and_all_baselines(session):
    ids = services.list_account_ids(session)
    assert len(ids) == 4500 and ids == sorted(ids) and KNOWN in ids
    assert sorted(services.get_all_baselines(session)) == ids


def test_app_engine_is_read_only(db_engine):
    with db_engine.connect() as c, pytest.raises(DBAPIError, match="read-only"):
        c.execute(text("DELETE FROM account_metrics WHERE account_id = 1"))


def test_statement_timeout_is_set(db_engine):
    with db_engine.connect() as c:
        assert c.execute(text("SHOW statement_timeout")).scalar() == "5s"
