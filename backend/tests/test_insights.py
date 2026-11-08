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
