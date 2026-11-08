"""Offline, exploratory loan-risk ranking; not a lending or probability model."""
from __future__ import annotations

import csv
import math
import os
import statistics
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Iterable

FEATURE_NAMES = (
    "log_loan_amount",
    "loan_term_years",
    "payment_to_income",
    "cashflow_to_income",
    "income_variability",
    "bills_to_income",
    "buffer_to_spending",
    "days_below_zero",
)
COMPLETED_STATUS_LABELS = {"A": 0, "B": 1}
HISTORY_MONTHS = 3
L2_STRENGTH = 0.1
MAX_EPOCHS = 1800


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as file:
        return list(csv.DictReader(file))


def _month_index(value: str) -> int:
    year, month = map(int, value[:7].split("-"))
    if not 1 <= month <= 12:
        raise ValueError(f"Invalid month: {value}")
    return year * 12 + month


def _number(row: dict[str, str], field: str) -> float:
    value = row.get(field, "")
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Missing or invalid {field}: {value!r}") from None
    if not math.isfinite(result):
        raise ValueError(f"Non-finite {field}: {value!r}")
    return result


def _complete_history(
    account_rows: list[dict[str, str]], loan_start: str
) -> list[dict[str, str]] | None:
    start_month = _month_index(loan_start)
    prior = sorted(
        (row for row in account_rows if _month_index(row["month"]) < start_month),
        key=lambda row: row["month"],
    )
    prior = prior[-HISTORY_MONTHS:]
    if len(prior) != HISTORY_MONTHS:
        return None
    indices = [_month_index(row["month"]) for row in prior]
    if indices != list(range(start_month - HISTORY_MONTHS, start_month)):
        return None
    return prior


def _features(
    loan: dict[str, str], history: list[dict[str, str]]
) -> tuple[float, ...]:
    incomes = [_number(row, "money_in") for row in history]
    outflows = [_number(row, "money_out") for row in history]
    bills = [
        _number(row, "household_bills") + _number(row, "insurance")
        for row in history
    ]
    income = statistics.median(incomes)
    spending = statistics.median(outflows)
    denominator = max(income, 1.0)
    income_mean = statistics.fmean(incomes)
    income_cv = (
        statistics.pstdev(incomes) / abs(income_mean) if income_mean else 0.0
    )
    monthly_balance = statistics.median(
        _number(row, "avg_daily_balance") for row in history
    )
    days_below_zero = statistics.median(
        _number(row, "days_below_zero") for row in history
    )
    amount = _number(loan, "amount")
    duration = _number(loan, "duration_months")
    payment = _number(loan, "monthly_payment")
    if amount < 0 or duration <= 0 or payment < 0:
        raise ValueError(f"Invalid loan terms for loan {loan.get('loan_id')}")

    return (
        math.log1p(amount),
        duration / 12,
        min(payment / denominator, 20.0),
        statistics.median(
            (monthly_income - monthly_out) / max(monthly_income, 1.0)
            for monthly_income, monthly_out in zip(incomes, outflows)
        ),
        min(income_cv, 5.0),
        min(statistics.median(value / denominator for value in bills), 20.0),
        max(-20.0, min(monthly_balance / max(spending, 1.0), 20.0)),
        min(days_below_zero, 31.0) / 31.0,
    )


def load_dataset(data_dir: Path) -> tuple[list[dict], list[dict], Counter]:
    """Return completed-loan examples, ongoing-loan examples, and status counts."""
    loans = _read_csv(data_dir / "loans.csv")
    months = _read_csv(data_dir / "monthly_summary.csv")
    history_by_account: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in months:
        history_by_account[row["account_id"]].append(row)

    examples = []
    ongoing = []
    statuses = Counter()
    seen_accounts: set[str] = set()
    for loan in loans:
        account_id = loan["account_id"]
        if account_id in seen_accounts:
            raise ValueError(f"Multiple loans for account {account_id}")
        seen_accounts.add(account_id)
        status = loan["status"]
        statuses[status] += 1
        history = _complete_history(
            history_by_account.get(account_id, []), loan["loan_start"]
        )
        if history is None:
            continue
        item = {
            "account_id": account_id,
            "loan_id": loan["loan_id"],
            "status": status,
            "features": _features(loan, history),
        }
        if status in COMPLETED_STATUS_LABELS:
            expected_default = str(COMPLETED_STATUS_LABELS[status])
            if loan.get("defaulted") != expected_default:
                raise ValueError(
                    f"Status/defaulted mismatch for loan {loan['loan_id']}"
                )
            item["label"] = COMPLETED_STATUS_LABELS[status]
            examples.append(item)
        elif status in {"C", "D"}:
            ongoing.append(item)
        else:
            raise ValueError(f"Unknown loan status {status!r}")
    return examples, ongoing, statuses


def _sigmoid(value: float) -> float:
    if value >= 0:
        exp_value = math.exp(-min(value, 700.0))
        return 1.0 / (1.0 + exp_value)
    exp_value = math.exp(max(value, -700.0))
    return exp_value / (1.0 + exp_value)


def _fit(examples: list[dict]) -> dict:
    if not examples or len({item["label"] for item in examples}) != 2:
        raise ValueError("Training requires both completed-loan outcome classes")
    rows = [item["features"] for item in examples]
    labels = [item["label"] for item in examples]
    width = len(FEATURE_NAMES)
    means = [statistics.fmean(row[i] for row in rows) for i in range(width)]
    scales = [
        statistics.pstdev(row[i] for row in rows) or 1.0 for i in range(width)
    ]
    normalized = [
        [max(-6.0, min(6.0, (value - means[i]) / scales[i]))
         for i, value in enumerate(row)]
        for row in rows
    ]
    positives = sum(labels)
    negatives = len(labels) - positives
    weights = [
        len(labels) / (2 * positives) if label else len(labels) / (2 * negatives)
        for label in labels
    ]

    coefficients = [0.0] * width
    intercept = 0.0
    for _ in range(MAX_EPOCHS):
        gradient = [L2_STRENGTH * value for value in coefficients]
        intercept_gradient = 0.0
        for row, label, sample_weight in zip(normalized, labels, weights):
            prediction = _sigmoid(intercept + sum(
                coefficient * value
                for coefficient, value in zip(coefficients, row)
            ))
            error = (prediction - label) * sample_weight / len(labels)
            intercept_gradient += error
            for index, value in enumerate(row):
                gradient[index] += error * value
        rate = 0.08
        intercept -= rate * intercept_gradient
        coefficients = [
            coefficient - rate * change
            for coefficient, change in zip(coefficients, gradient)
        ]
    return {
        "means": means,
        "scales": scales,
        "coefficients": coefficients,
        "intercept": intercept,
    }


def _score(model: dict, features: Iterable[float]) -> float:
    normalized = [
        max(-6.0, min(6.0, (value - model["means"][i]) / model["scales"][i]))
        for i, value in enumerate(features)
    ]
    return _sigmoid(model["intercept"] + sum(
        coefficient * value
        for coefficient, value in zip(model["coefficients"], normalized)
    ))


def _auc(scored: list[tuple[int, float]]) -> float:
    positives = [score for label, score in scored if label == 1]
    negatives = [score for label, score in scored if label == 0]
    if not positives or not negatives:
        raise ValueError("AUC requires positive and negative outcomes")
    wins = sum(
        1.0 if positive > negative else 0.5 if positive == negative else 0.0
        for positive in positives
        for negative in negatives
    )
    return wins / (len(positives) * len(negatives))


def cross_validate(examples: list[dict], folds: int = 5) -> dict:
    """Stratified folds; outputs ranking and threshold diagnostics, not calibration."""
    by_label: dict[int, list[dict]] = defaultdict(list)
    for item in examples:
        by_label[item["label"]].append(item)
    if min(map(len, by_label.values()), default=0) < folds or len(by_label) != 2:
        raise ValueError(f"Need at least {folds} examples from each class")
    fold_by_id: dict[str, int] = {}
    for label_items in by_label.values():
        for index, item in enumerate(sorted(label_items, key=lambda x: x["account_id"])):
            fold_by_id[item["account_id"]] = index % folds

    predictions: list[tuple[int, float]] = []
    for fold in range(folds):
        train = [
            item for item in examples
            if fold_by_id[item["account_id"]] != fold
        ]
        test = [
            item for item in examples
            if fold_by_id[item["account_id"]] == fold
        ]
        model = _fit(train)
        predictions.extend(
            (item["label"], _score(model, item["features"])) for item in test
        )
    tp = sum(label == 1 and score >= 0.5 for label, score in predictions)
    tn = sum(label == 0 and score < 0.5 for label, score in predictions)
    positives = sum(label == 1 for label, _ in predictions)
    negatives = len(predictions) - positives
    return {
        "examples": len(predictions),
        "defaults": positives,
        "repaid": negatives,
        "auc": _auc(predictions),
        "sensitivity_at_0_5": tp / positives,
        "specificity_at_0_5": tn / negatives,
        "balanced_accuracy_at_0_5": (tp / positives + tn / negatives) / 2,
    }


def run(data_dir: Path) -> tuple[dict, list[dict], Counter]:
    examples, ongoing, statuses = load_dataset(data_dir)
    metrics = cross_validate(examples)
    final_model = _fit(examples)
    for item in ongoing:
        item["relative_score"] = round(100 * _score(final_model, item["features"]), 1)
    return metrics, ongoing, statuses


@lru_cache(maxsize=1)
def _ongoing_loan_rankings(data_dir: Path) -> tuple[dict[str, tuple[float, str]], int, int]:
    examples, ongoing, _ = load_dataset(data_dir)
    model = _fit(examples)
    scored = [
        (item["account_id"], _score(model, item["features"]))
        for item in ongoing
    ]
    ordered_scores = sorted(score for _, score in scored)
    if not ordered_scores:
        return {}, len(examples), sum(item["label"] for item in examples)
    lower_quartile = ordered_scores[int((len(ordered_scores) - 1) * 0.25)]
    upper_quartile = ordered_scores[int((len(ordered_scores) - 1) * 0.75)]
    rankings = {}
    for account_id, score in scored:
        if score >= upper_quartile:
            band = "Higher relative ranking"
        elif score <= lower_quartile:
            band = "Lower relative ranking"
        else:
            band = "Middle relative ranking"
        rankings[account_id] = (score, band)
    return rankings, len(examples), sum(item["label"] for item in examples)


def account_risk_indicator(account_id: int, loan_status: str) -> dict:
    if loan_status not in {"C", "D"}:
        return {
            "available": False,
            "reason": "No ongoing loan to compare.",
        }

    data_dir = Path(os.environ.get(
        "TANGERINE_DATA_DIR", Path(__file__).resolve().parents[1] / "data" / "history"
    ))
    rankings, training_loans, defaults = _ongoing_loan_rankings(data_dir)
    result = rankings.get(str(account_id))
    if result is None:
        return {
            "available": False,
            "reason": "Not enough complete pre-loan monthly history to rank this loan.",
        }

    _, band = result
    return {
        "available": True,
        "label": "Experimental relative loan-risk ranking",
        "band": band,
        "comparison_group_size": len(rankings),
        "completed_training_loans": training_loans,
        "completed_defaults": defaults,
        "basis": "Three complete monthly records before loan origination.",
        "caveat": (
            "Relative ranking only, not a probability or current-risk estimate. "
            "Based on a small historical sample and not validated for decisions."
        ),
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "history",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional CSV path for relative scores on ongoing loans.",
    )
    args = parser.parse_args()
    metrics, ongoing, statuses = run(args.data_dir)
    print("Research prototype only; scores are relative rankings, not probabilities.")
    print(f"Loan statuses: {dict(sorted(statuses.items()))}")
    print(
        f"Cross-validation: {metrics['examples']} completed loans "
        f"({metrics['defaults']} defaulted, {metrics['repaid']} repaid), "
        f"5-fold stratified ROC AUC={metrics['auc']:.3f}, "
        f"balanced accuracy={metrics['balanced_accuracy_at_0_5']:.3f}, "
        f"sensitivity={metrics['sensitivity_at_0_5']:.3f}, "
        f"specificity={metrics['specificity_at_0_5']:.3f}"
    )
    print(f"Scored {len(ongoing)} ongoing loans using pre-origination data.")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=["account_id", "loan_id", "status", "relative_score"],
            )
            writer.writeheader()
            writer.writerows(
                {field: item[field] for field in writer.fieldnames}
                for item in sorted(
                    ongoing, key=lambda item: item["relative_score"], reverse=True
                )
            )
        print(f"Wrote relative-score CSV to {args.output}")


if __name__ == "__main__":
    main()
