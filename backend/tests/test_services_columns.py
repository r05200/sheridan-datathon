"""The SQLAlchemy services against the real account_metrics columns.

Runs with no Postgres and no CSVs: it loads the committed SQL backup (backend/sql/account_metrics.sql) into
in-memory SQLite and checks that schema.py, the dataclasses in types.py, the services and the backup all agree.
"""
from dataclasses import fields

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.db import AccountNotFound, NoHistory, services
from app.db.config import BACKUP_SQL, build_backup_engine
from app.db.schema import account_metrics as m
from app.db.types import AccountSnapshot, Baseline, BaselineMetrics, FlexibleSpending

KNOWN = 20111
COLUMNS = {c.name for c in m.columns}


@pytest.fixture(scope="module")
def engine():
    eng = build_backup_engine()
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


# --------------------------------------------------------------------------- schema <-> dataclasses <-> backup
@pytest.mark.parametrize("cls", [Baseline, FlexibleSpending, BaselineMetrics])
def test_every_dataclass_field_is_a_column(cls):
    assert {f.name for f in fields(cls)} <= COLUMNS


def test_no_column_is_silently_ignored():
    used = {f.name for cls in (Baseline, FlexibleSpending, BaselineMetrics) for f in fields(cls)} | {"loan_payment"}
    assert COLUMNS - used == set()


def test_backup_file_matches_schema_columns(engine):
    """A stale sql/account_metrics.sql (schema changed, backup not regenerated) fails here."""
    live = {c["name"] for c in inspect(engine).get_columns("account_metrics")}
    assert live == COLUMNS, f"regenerate the backup: python scripts/setup_db.py --sql sql/account_metrics.sql ({live ^ COLUMNS})"


def test_backup_has_every_account_once(session):
    n, distinct = session.execute(text("SELECT COUNT(*), COUNT(DISTINCT account_id) FROM account_metrics")).one()
    assert n == distinct == 4500


# --------------------------------------------------------------------------- every row maps value for value
def test_snapshot_matches_raw_columns_for_every_account(session):
    raw = {r["account_id"]: r for r in session.execute(select(m)).mappings()}
    checked = 0
    for account_id, row in raw.items():
        snap = services.get_account_snapshot(session, account_id)
        for part in (snap.baseline, snap.flexible, snap.metrics):
            for f in fields(part):
                assert getattr(part, f.name) == row[f.name], (account_id, f.name)
        assert snap.loan_payment == (row["loan_payment"] or 0.0)
        checked += 1
    assert checked == 4500


def test_get_all_baselines_returns_every_filled_account(session):
    ids = services.list_account_ids(session)
    assert ids == sorted(ids) and len(ids) == 4500
    assert sorted(services.get_all_baselines(session)) == ids


# --------------------------------------------------------------------------- python types
def test_field_types_are_plain_python(session):
    snap = services.get_account_snapshot(session, KNOWN)
    for f in fields(Baseline):
        v = getattr(snap.baseline, f.name)
        assert type(v) in (int, float), (f.name, type(v))            # no Decimal, no str
    assert type(snap.baseline.months_of_history) is int
    for f in fields(FlexibleSpending):
        assert type(getattr(snap.flexible, f.name)) in (int, float), f.name
    assert type(snap.loan_payment) is float
    assert type(snap.metrics.has_shortfall) is bool and type(snap.metrics.runway_capped) is bool
    assert type(snap.metrics.goal_target_months) is int


def test_known_account_values(session):
    snap = services.get_account_snapshot(session, KNOWN)
    assert snap.baseline.income == pytest.approx(6339.39)
    assert snap.baseline.months_of_history == 38
    assert snap.loan_payment == pytest.approx(2330.19)
    assert snap.metrics.has_shortfall is True and snap.metrics.runway_months == pytest.approx(7.8)
    assert snap.metrics.goal_months_to_goal is None                  # NULL stays None, not 0


def test_each_service_agrees_with_the_snapshot(session):
    snap = services.get_account_snapshot(session, KNOWN)
    assert services.get_account_baseline(session, KNOWN) == snap.baseline
    assert services.get_flexible_spending(session, KNOWN) == snap.flexible
    assert services.get_loan_payment(session, KNOWN) == snap.loan_payment
    assert services.get_baseline_metrics(session, KNOWN) == snap.metrics


@pytest.mark.parametrize("fn", [
    services.get_account_snapshot, services.get_account_baseline, services.get_flexible_spending,
    services.get_loan_payment, services.get_baseline_metrics,
])
def test_unknown_account_raises_account_not_found(session, fn):
    with pytest.raises(AccountNotFound):
        fn(session, 1)


# --------------------------------------------------------------------------- NULL handling
def _insert(session, **values):
    session.execute(m.insert().values(**values))


FILLED = dict(income=1000.0, spending=900.0, household_bills=100.0, fixed_costs=300.0, buffer=5000.0,
              months_of_history=12)


def test_bare_row_is_listed_but_has_no_history(session):
    _insert(session, account_id=1)
    assert 1 in services.list_account_ids(session)
    assert 1 not in services.get_all_baselines(session)
    assert services.get_loan_payment(session, 1) == 0.0                # NULL payment means no loan
    assert services.get_baseline_metrics(session, 1).runway_months is None
    for fn in (services.get_account_snapshot, services.get_account_baseline, services.get_flexible_spending):
        with pytest.raises(NoHistory):
            fn(session, 1)


@pytest.mark.parametrize("missing", ["income", "spending", "household_bills", "fixed_costs", "buffer",
                                     "months_of_history"])
def test_any_missing_baseline_input_is_no_history(session, missing):
    _insert(session, account_id=2, **{**FILLED, missing: None})
    with pytest.raises(NoHistory):
        services.get_account_baseline(session, 2)
    assert 2 not in services.get_all_baselines(session)


def test_missing_flexible_spending_is_zero_not_none(session):
    """The engine does arithmetic on these; a NULL must not reach it as None."""
    _insert(session, account_id=3, **FILLED)                           # flexible columns left NULL
    flex = services.get_flexible_spending(session, 3)
    assert (flex.card_withdrawals, flex.cash_withdrawals, flex.transfers_out_other) == (0.0, 0.0, 0.0)
    snap = services.get_account_snapshot(session, 3)
    assert snap.flexible == flex and snap.loan_payment == 0.0
