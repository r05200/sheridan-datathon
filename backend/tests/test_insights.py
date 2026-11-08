from fastapi.testclient import TestClient

from app import insights
from app.main import app


def test_directory_has_expected_account_cohorts():
    result = insights.account_directory()

    assert result["total_accounts"] == 4500
    assert result["cohort_counts"]["troubled_loan_no_shortfall_count"] == 33
    assert result["cohort_counts"]["no_loan_prior_negative_count"] == 212
    assert result["cohort_counts"]["pension_majority_count"] == 740

    with TestClient(app) as client:
        troubled = client.get(
            "/api/tangerine/accounts", params={"filter": "troubled_loans_healthy"}
        )
        no_loan_negative = client.get(
            "/api/tangerine/accounts", params={"filter": "no_loan_negative"}
        )

    assert troubled.status_code == 200
    assert troubled.json()["matched_accounts"] == 33
    assert no_loan_negative.status_code == 200
    assert no_loan_negative.json()["matched_accounts"] == 212


def test_watchlist_only_contains_never_negative_accounts():
    result = insights.account_directory("watchlist")

    assert result["matched_accounts"] == result["cohort_counts"]["never_negative_count"]
    assert all(not account["past_negative_month"] for account in result["accounts"])
    assert all(account["watchlist_band"] for account in result["accounts"])
    assert result["watchlist_validation"]["priority_band_size"] > 0
    assert result["watchlist_validation"]["priority_band_hit_rate"] < 0.1


def test_baseline_endpoint_includes_stress_and_comparison_signals():
    with TestClient(app) as client:
        response = client.get("/api/accounts/93088/baseline")

    assert response.status_code == 200
    result = response.json()
    assert result["stress"]["negative_month_count"] == 5
    assert result["stress"]["worst_observed_balance"] < 0
    assert result["stress"]["loan_contract_monthly_payment"] > 0
    assert result["stress"]["median_observed_loan_payment"] == 0
    assert result["stress"]["loan_risk"]["available"] is True
    assert "relative" in result["stress"]["loan_risk"]["label"].lower()
    assert result["stress"]["reverse_stress"]["horizon_months"] == 6
    assert isinstance(result["stress"]["reverse_stress"]["additional_buffer_for_target"], float)
    assert result["stress"]["spending_drift"]["available"] is True
    assert result["stress"]["buffer_status"]["available"] is True
    assert result["peer_context"]["income_band"].startswith("Income quartile")
    assert result["watchlist"]["eligible"] is False
    assert result["watchlist"]["rank"] is None
    monthly_history = result["stress"]["monthly_history"]
    assert len(monthly_history) == 12
    assert monthly_history[-1]["month"] == result["stress"]["last_month"]
    assert all(
        {"month", "money_in", "money_out", "month_end_balance"} <= month.keys()
        for month in monthly_history
    )
    eligible_watchlist = insights.account_insights(38346)["watchlist"]
    assert 1 <= eligible_watchlist["rank"] <= eligible_watchlist["eligible_accounts"]


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


def test_plan_includes_historical_context_without_changing_calculations():
    with TestClient(app) as client:
        response = client.post("/api/plan", json={"account_id": 93088})

    assert response.status_code == 200
    plan = response.json()
    observations = plan["account_context"]["historical_observations"]
    assert observations
    assert "Historical observations provide context only" in plan["account_context"]["limitation"]
    from app.explainer import template_explanation

    explanation = template_explanation(plan)
    assert "Historical context:" in explanation["summary"]
    assert "Recent recorded spending" in explanation["summary"]
    assert len(explanation["summary"].split()) <= 70


def test_portfolio_summary_matches_full_precision_scenario_counts():
    with TestClient(app) as client:
        response = client.get("/api/tangerine/portfolio")

    assert response.status_code == 200
    result = response.json()
    assert result["total_accounts"] == 4500
    assert result["baseline"]["spending_exceeds_income"] == 1181
    assert result["baseline"]["under_twelve_months"] == 241
    assert result["baseline"]["under_six_months"] == 120
    assert result["baseline"]["can_cover_six_months_at_zero_income"] == 1299
    assert result["scenarios"]["income_at_55_percent"]["under_six_months"] == 1578
    assert result["scenarios"]["income_at_55_percent_and_bills_up_15_percent"]["under_six_months"] == 1740
    assert result["scenarios"]["income_at_55_percent_and_bills_up_15_percent"]["additional_under_six_vs_55_percent_income"] == 162
    repair = result["scenarios"]["one_month_spending_repair"]
    assert repair["buffers_depleted_after_scenario"] == 181
    assert repair["newly_depleted_buffers"] == 158
    assert repair["under_six_months"] == 393


def test_pension_accounts_explain_ei_comparison():
    pension_account = next(
        account_id for account_id, row in insights._dataset()["by_id"].items()
        if row["pension_majority"]
    )
    with TestClient(app) as client:
        response = client.get(f"/api/accounts/{pension_account}/baseline")

    pension = response.json()["pension_check"]
    assert pension["pension_majority"] is True
    assert "does not apply to pension income" in pension["interpretation"]


def test_recent_income_warning_says_median_overstates_recent_income():
    account_id = next(
        account_id for account_id, row in insights._dataset()["by_id"].items()
        if row["income_median_overstates_recent"]
    )

    result = insights.account_insights(account_id)

    assert result["stress"]["income_trend"]["median_overstates_recent"] is True
    assert "overstates recent income" in result["stress"]["income_trend"]["label"]


def test_frozen_spotlights_include_the_three_demo_cases():
    result = insights.spotlight_snapshots()

    assert [item["account_id"] for item in result["accounts"]] == [38346, 93088, 90553]
    assert all("stress" in item and "peer_context" in item for item in result["accounts"])
    assert all("validation" in item["watchlist"] for item in result["accounts"])
    assert all(len(item["stress"]["monthly_history"]) == 12 for item in result["accounts"])
