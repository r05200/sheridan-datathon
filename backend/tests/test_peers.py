"""Peer comparison: a deterministic cohort by income, fixed costs and loan payment. No database needed."""
import pytest
from fastapi.testclient import TestClient

from app.db import AccountNotFound, get_session
from app.finance.peers import MAX_PEERS, compare_peers
from app.main import app


def _row(income=4000.0, fixed=1200.0, loan=0.0, spending=3500.0, bills=900.0, cash=300.0, card=800.0,
         transfers=200.0):
    return {"income": income, "spending": spending, "household_bills": bills, "fixed_costs": fixed,
            "loan_payment": loan, "cash_withdrawals": cash, "card_withdrawals": card,
            "transfers_out_other": transfers}


def test_unknown_account_raises():
    with pytest.raises(AccountNotFound):
        compare_peers(1, {2: _row()})


def test_invalid_target_is_unavailable():
    result = compare_peers(1, {1: _row(income=float("nan")), 2: _row()})
    assert result["status"] == "unavailable" and result["comparisons"] == []


def test_too_few_matches_gives_no_suggestions():
    records = {1: _row(), **{i: _row(income=4000 + 50 * i) for i in range(2, 7)}}
    result = compare_peers(1, records)
    assert result["status"] == "insufficient_peers"
    assert result["peer_count"] == 5 and result["comparisons"] == []


def test_cohort_excludes_self_other_loan_status_and_distant_income():
    records = {1: _row(spending=4200.0, cash=900.0)}
    for i in range(2, 32):
        records[i] = _row(income=4000 + 10 * i)       # 30 close peers, no loan
    records[100] = _row(loan=500.0)                   # has a loan payment: different status, excluded
    records[101] = _row(income=9000.0)                # more than 30% away on income, excluded
    result = compare_peers(1, records)
    assert result["status"] == "ok"
    assert result["peer_count"] == 30 and result["eligible_count"] == 30
    by_key = {c["key"]: c for c in result["comparisons"]}
    assert by_key["spending"]["above_median"] and by_key["spending"]["difference"] == pytest.approx(700.0)
    assert by_key["spending"]["pct_above_median"] == pytest.approx(20.0)
    assert by_key["cash_withdrawals"]["pct_above_median"] == pytest.approx(200.0)
    assert not by_key["household_bills"]["above_median"]
    assert by_key["household_bills"]["pct_above_median"] is None
    assert all(c["can_sum_with_other_gaps"] is False for c in result["comparisons"])


def test_cohort_is_capped_at_the_closest_matches():
    records = {1: _row()}
    for i in range(2, 2 + MAX_PEERS + 20):
        records[i] = _row(income=4000 + 5 * i)
    result = compare_peers(1, records)
    assert result["peer_count"] == MAX_PEERS and result["eligible_count"] == MAX_PEERS + 20


def test_peers_endpoint_without_database_is_503(no_database):
    try:
        with TestClient(app) as client:
            assert client.get("/api/accounts/20111/peers").status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_peers_endpoint_with_database(session):
    app.dependency_overrides[get_session] = lambda: session
    try:
        with TestClient(app) as client:
            body = client.get("/api/accounts/20111/peers").json()
            assert body["status"] in {"ok", "insufficient_peers"}
            assert body["method"]["minimum_peers"] == 10
            assert client.get("/api/accounts/1/peers").status_code == 404
    finally:
        app.dependency_overrides.clear()
