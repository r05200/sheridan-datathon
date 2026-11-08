import pytest
from fastapi.testclient import TestClient
from app import db, insights
from app.main import app


def test_baseline_history_uses_current_baseline(monkeypatch):
    baseline = {'income': 3000., 'spending': 2600., 'buffer': 5200., 'household_bills': 800., 'fixed_costs': 1000., 'months_of_history': 24}
    monkeypatch.setattr(db, 'get_account_baseline', lambda _: dict(baseline))
    monkeypatch.setattr(db, 'get_loan_payment', lambda _: 0.)
    monkeypatch.setattr(db, 'get_flexible_spending', lambda _: 1600.)
    result = TestClient(app).get('/api/accounts/20134/baseline').json()
    assert result['income'] == 3000
    assert result['stress']['reverse_stress']['maximum_income_loss_pct'] == 42.2
    assert result['stress']['buffer_status']['baseline_buffer'] == 5200
    assert len(result['stress']['monthly_history']) == 12
    assert result['history_source'] == 'bundled_challenge_snapshot'


def test_missing_history_does_not_break_baseline(monkeypatch):
    def unavailable(*args):
        raise insights.InsightsUnavailable('Missing history')
    monkeypatch.setattr(insights, 'account_insights', unavailable)
    response = TestClient(app).get('/api/accounts/20134/baseline')
    assert response.status_code == 200
    assert response.json()['history_available'] is False
    assert response.json()['income'] > 0


def test_unknown_account_still_returns_404():
    assert TestClient(app).get('/api/accounts/99999999/baseline').status_code == 404


def test_reverse_stress_handles_zero_income_and_uncovered_baseline():
    ordinary = insights.reverse_stress(3000, 2600, 5200)
    assert ordinary["baseline_coverage"] is True
    assert ordinary["maximum_income_loss_pct"] == 42.2
    assert ordinary["additional_buffer_for_target"] == 1400

    zero_income = insights.reverse_stress(0, 1000, 6000)
    assert zero_income["maximum_income_loss_pct"] is None
    assert zero_income["zero_income_coverage"] is True
    assert zero_income["additional_buffer_for_target"] == 0

    uncovered = insights.reverse_stress(100, 200, 300)
    assert uncovered["baseline_coverage"] is False
    assert uncovered["maximum_income_loss_pct"] is None
    assert uncovered["additional_buffer_for_target"] == 600


def test_spending_drift_compares_the_same_calendar_months_one_year_prior():
    history = []
    for year, month, spending in [
        (2024, 1, 100), (2024, 2, 100), (2024, 3, 100),
        (2024, 4, 100), (2024, 5, 100), (2024, 6, 100),
        (2024, 7, 100), (2024, 8, 100), (2024, 9, 100),
        (2024, 10, 100), (2024, 11, 100), (2024, 12, 100),
        (2025, 1, 160), (2025, 2, 160), (2025, 3, 160),
    ]:
        history.append({
            "month": f"{year:04d}-{month:02d}",
            "money_in": 200,
            "money_out": spending,
            "loan_payments": 0,
            "cash_withdrawals": 0,
            "month_end_balance": 1000,
            "min_balance": 900,
            "days_below_zero": 0,
        })

    result = insights._history_signals(history)

    assert result["spending_drift_ratio"] == 1.6
    assert result["spending_drift_flag"] is True
    assert result["same_months_prior_year_spending_3m"] == 300
