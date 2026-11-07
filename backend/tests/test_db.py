import pandas as pd
import pytest

from app import config, db
from app.baseline_calc import compute_baselines


def test_known_account_baseline_offline():
    b = db.get_account_baseline(20111)
    assert b["income"] == pytest.approx(6339.39) and b["months_of_history"] == 38


def test_unknown_account_is_a_clear_error():
    for fn in (db.get_account_baseline, db.get_loan_payment, db.get_flexible_spending):
        with pytest.raises(db.AccountNotFound):
            fn(1)


def test_all_baselines_one_row_per_account():
    assert len(db.get_all_baselines()) == 4500


def test_loan_payment_running_vs_finished(data_dir):
    loans = pd.read_csv(data_dir / "loans.csv")
    running = loans[loans.status.isin(["C", "D"])].iloc[0]       # running at end of 2025
    finished = loans[loans.status == "A"].iloc[0]                 # finished, repaid
    assert db.get_loan_payment(int(running.account_id)) == pytest.approx(running.monthly_payment, abs=0.01)
    assert db.get_loan_payment(int(finished.account_id)) == 0
    no_loan = next(a for a in pd.read_csv(data_dir / "accounts.csv").account_id if a not in set(loans.account_id))
    assert db.get_loan_payment(int(no_loan)) == 0


def test_unreachable_database_falls_back_to_export(monkeypatch):
    monkeypatch.setenv("DB_DISABLED", "0")
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@127.0.0.1:1/none")
    monkeypatch.setattr(config, "DB_CONNECT_TIMEOUT_S", 1)
    assert db.get_account_baseline(20111)["income"] == pytest.approx(6339.39)
    assert db.get_loan_payment(20111) == pytest.approx(2330.19)


def test_export_matches_pandas_reference(data_dir):
    ref = compute_baselines(data_dir).set_index("account_id")
    db._offline_rows.cache_clear()
    for acct in ref.index[:5]:
        got = db.get_account_baseline(int(acct))
        for k in ("income", "spending", "household_bills", "fixed_costs", "buffer"):
            assert got[k] == pytest.approx(ref.loc[acct, k], abs=0.01)


def test_sql_view_equals_pandas_on_hand_checked_accounts(data_dir):
    """Run the real view SQL (DuckDB executes percentile_cont WITHIN GROUP) against the CSVs."""
    duckdb = pytest.importorskip("duckdb")
    con = duckdb.connect()
    con.execute(f"CREATE TABLE monthly_summary AS SELECT * FROM read_csv_auto('{data_dir / 'monthly_summary.csv'}')")
    sql = (config.BACKEND_DIR / "sql" / "account_baseline.sql").read_text()
    con.execute(sql)
    view = con.execute("SELECT * FROM account_baseline").df().set_index("account_id")
    ref = compute_baselines(data_dir).set_index("account_id")
    assert len(view) == ref.index.nunique() == 4500
    for acct in list(ref.index[:5]) + [ref.index[-1]]:
        for k in ("income", "spending", "household_bills", "fixed_costs", "buffer",
                  "card_withdrawals", "cash_withdrawals", "transfers_out_other", "months_of_history"):
            assert view.loc[acct, k] == pytest.approx(ref.loc[acct, k], rel=1e-9, abs=1e-6), (acct, k)
