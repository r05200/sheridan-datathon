"""API wiring: db errors map to HTTP codes; endpoints read through a Session."""
import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app


@pytest.fixture
def client():
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_no_database_config_is_503_but_parser_still_works(client, no_database):
    assert client.get("/api/health").json()["database"] == "not_configured"
    assert client.get("/api/accounts/20111/baseline").status_code == 503
    assert client.post("/api/parse-shock", json={"text": "I lost my job"}).status_code == 200


def test_endpoints_with_database(client, session):
    app.dependency_overrides[get_session] = lambda: session
    body = client.get("/api/accounts/20111/baseline").json()
    assert body["months_of_history"] == 38 and body["loan_payment"] == pytest.approx(2330.19)
    assert set(body["flexible_spending"]) == {"card_withdrawals", "cash_withdrawals", "transfers_out_other"}
    assert client.get("/api/accounts/1/baseline").status_code == 404
    plan = client.post("/api/plan", json={"account_id": 20111, "shock": {"income_multiplier": 0.55}})
    assert plan.status_code == 200 and plan.json()["after_shock"]["income"] == round(0.55 * 6339.39)
    assert client.post("/api/plan", json={"account_id": 1}).status_code == 404
