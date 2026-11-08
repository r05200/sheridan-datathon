import csv

from app.default_risk import (
    _complete_history,
    _features,
    account_risk_indicator,
    cross_validate,
    load_dataset,
)


def test_history_uses_only_three_complete_months_before_loan_start():
    rows = [
        {"month": month}
        for month in ("2024-12", "2025-01", "2025-02", "2025-03")
    ]
    history = _complete_history(rows, "2025-04-15")
    assert [row["month"] for row in history] == ["2025-01", "2025-02", "2025-03"]
    assert _complete_history(
        [rows[0], rows[2], rows[3]], "2025-04-15"
    ) is None


def test_features_are_finite_and_have_expected_width():
    loan = {
        "loan_id": "loan-1",
        "amount": "10000",
        "duration_months": "24",
        "monthly_payment": "500",
    }
    history = [
        {
            "money_in": "3000",
            "money_out": "2500",
            "household_bills": "800",
            "insurance": "100",
            "avg_daily_balance": "2000",
            "days_below_zero": "0",
        }
    ] * 3
    features = _features(loan, history)
    assert len(features) == 8
    assert all(value == value and abs(value) != float("inf") for value in features)


def test_dataset_excludes_running_loans_from_confirmed_outcome_labels(data_dir):
    examples, ongoing, statuses = load_dataset(data_dir)
    assert len(examples) == 234
    assert sum(item["label"] == 1 for item in examples) == 31
    assert len(ongoing) == 448
    assert statuses == {"A": 203, "B": 31, "C": 403, "D": 45}


def test_cross_validation_reports_metrics_on_held_out_examples():
    examples = [
        {
            "account_id": str(index),
            "label": index % 2,
            "features": (
                float(index % 2), float(index), 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
            ),
        }
        for index in range(20)
    ]
    result = cross_validate(examples, folds=5)
    assert result["examples"] == 20
    assert result["defaults"] == 10
    assert result["repaid"] == 10
    assert 0 <= result["auc"] <= 1
    assert 0 <= result["balanced_accuracy_at_0_5"] <= 1


def test_account_risk_indicator_is_relative_and_only_available_for_running_loans(data_dir):
    from app import default_risk

    default_risk._ongoing_loan_rankings.cache_clear()
    with (data_dir / "loans.csv").open(
        newline="", encoding="utf-8-sig"
    ) as file:
        loans = list(csv.DictReader(file))
    running = next(row for row in loans if row["status"] in {"C", "D"})
    result = account_risk_indicator(int(running["account_id"]), running["status"])
    assert result["available"] is True
    assert result["band"] in {
        "Higher relative ranking",
        "Middle relative ranking",
        "Lower relative ranking",
    }
    assert result["completed_training_loans"] == 234
    assert result["completed_defaults"] == 31
    assert "probability" in result["caveat"]
    assert account_risk_indicator(1, "A") == {
        "available": False,
        "reason": "No ongoing loan to compare.",
    }
