#!/usr/bin/env python3
"""Build account-month source data and challenge-defined customer profiles.

Uses only the Python standard library. Run with --help for commands.
"""

import argparse
import csv
import math
import statistics
from collections import defaultdict
from datetime import date
from functools import lru_cache
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_FIELDS = [
    "account_id", "month", "money_in", "money_out", "household_bills",
    "insurance", "loan_payments", "avg_daily_balance", "loan_id",
    "loan_status", "loan_monthly_payment",
]
MONTHLY_MONEY_FIELDS = RAW_FIELDS[2:8]
PROFILE_FIELDS = [
    "account_id", "first_month", "last_month", "months_observed",
    "buffer_months_used", "typical_monthly_money_in", "typical_monthly_spending",
    "typical_household_bills", "typical_fixed_costs", "savings_buffer",
    "active_loan_monthly_payment", "typical_monthly_surplus",
    "monthly_shortfall", "baseline_runway_months", "baseline_runway_status",
    "baseline_runway_capped", "loan_id", "loan_status",
]


def read_rows(path, required):
    with Path(path).open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = set(required) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{path}: missing columns {sorted(missing)}")
        yield from reader


def money(value, field, nonnegative=False):
    try:
        number = float(value)
    except (ValueError, TypeError) as error:
        raise ValueError(f"Invalid {field}: {value!r}") from error
    if not math.isfinite(number) or (nonnegative and number < 0):
        raise ValueError(f"Invalid {field}: {value!r}")
    return number


def account_id(value):
    number = int(value)
    if number <= 0:
        raise ValueError(f"Invalid account_id: {value!r}")
    return str(number)


@lru_cache(maxsize=1024)
def validate_month(value):
    # Require YYYY-MM so lexical sorting is chronological sorting.
    if len(value) != 7 or date.fromisoformat(value + "-01").strftime("%Y-%m") != value:
        raise ValueError(f"Invalid month: {value!r}")


def write_rows(path, fields, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def build_raw(source_dir):
    """One-to-many accounts/months plus a many-to-one loan lookup; no fan-out."""
    source_dir = Path(source_dir)
    accounts = set()
    for row in read_rows(source_dir / "accounts.csv", ["account_id"]):
        key = account_id(row["account_id"])
        if key in accounts:
            raise ValueError(f"Duplicate account: {key}")
        accounts.add(key)
    if not accounts:
        raise ValueError("accounts.csv contains no accounts")

    loans = {}
    loan_ids = set()
    required = ["account_id", "loan_id", "status", "monthly_payment"]
    for row in read_rows(source_dir / "loans.csv", required):
        key = account_id(row["account_id"])
        if key not in accounts or key in loans or row["loan_id"] in loan_ids:
            raise ValueError(f"Unknown/duplicate loan account or loan ID: {key}")
        if row["status"] not in {"A", "B", "C", "D"} or not row["loan_id"]:
            raise ValueError(f"Invalid loan metadata for account {key}")
        money(row["monthly_payment"], "monthly_payment", nonnegative=True)
        loans[key] = row
        loan_ids.add(row["loan_id"])

    rows = []
    seen = set()
    for row in read_rows(source_dir / "monthly_summary.csv", RAW_FIELDS[:8]):
        key = account_id(row["account_id"])
        validate_month(row["month"])
        observation = (key, row["month"])
        if key not in accounts or observation in seen:
            raise ValueError(f"Unknown account or duplicate account-month: {observation}")
        seen.add(observation)
        for field in MONTHLY_MONEY_FIELDS:
            money(row[field], field, nonnegative=field != "avg_daily_balance")
        loan = loans.get(key, {})
        rows.append({
            **{field: row[field] for field in RAW_FIELDS[:8]},
            "account_id": key,
            "loan_id": loan.get("loan_id", ""),
            "loan_status": loan.get("status", ""),
            "loan_monthly_payment": loan.get("monthly_payment", ""),
        })
    missing = accounts - {key for key, _ in seen}
    if missing:
        raise ValueError(f"Accounts without monthly history: {sorted(missing, key=int)[:10]}")
    return sorted(rows, key=lambda row: (int(row["account_id"]), row["month"]))


def baseline_runway(buffer, spending, income):
    # Preserve the README's branch order, including nonpositive buffers.
    gap = spending - income
    if buffer <= 0:
        return 0.0, "buffer_depleted", False
    if gap <= 0:
        return 120.0, "no_shortfall", False
    months = buffer / gap
    return round(min(months, 120), 1), "shortfall", months > 120


def process_raw(raw_path):
    """Compute all profile metrics exclusively from the unified source CSV."""
    groups = defaultdict(list)
    seen = set()
    for row in read_rows(raw_path, RAW_FIELDS):
        row["account_id"] = account_id(row["account_id"])
        validate_month(row["month"])
        key = (row["account_id"], row["month"])
        if key in seen:
            raise ValueError(f"Duplicate account-month: {key}")
        seen.add(key)
        for field in MONTHLY_MONEY_FIELDS:
            row[field] = money(row[field], field, nonnegative=field != "avg_daily_balance")
        if row["loan_status"]:
            if row["loan_status"] not in {"A", "B", "C", "D"} or not row["loan_id"]:
                raise ValueError(f"Invalid loan metadata: {key}")
            row["loan_monthly_payment"] = money(
                row["loan_monthly_payment"], "loan_monthly_payment", nonnegative=True
            )
        elif row["loan_id"] or row["loan_monthly_payment"]:
            raise ValueError(f"Incomplete loan metadata: {key}")
        groups[row["account_id"]].append(row)
    if not groups:
        raise ValueError("Raw CSV contains no observations")

    profiles = []
    for key in sorted(groups, key=int):
        rows = sorted(groups[key], key=lambda row: row["month"])
        metadata = {(r["loan_id"], r["loan_status"], r["loan_monthly_payment"]) for r in rows}
        if len(metadata) != 1:
            raise ValueError(f"Inconsistent loan snapshot for account {key}")
        typical = {field: statistics.median(r[field] for r in rows)
                   for field in ["money_in", "money_out", "household_bills"]}
        fixed = statistics.median(
            math.fsum(r[field] for field in ["household_bills", "insurance", "loan_payments"])
            for r in rows
        )
        recent = rows[-6:]
        buffer = math.fsum(r["avg_daily_balance"] for r in recent) / len(recent)
        income, spending = typical["money_in"], typical["money_out"]
        runway, status, capped = baseline_runway(buffer, spending, income)
        loan = rows[0]
        # C/D are the supplied end-of-2025 running-loan statuses. This is a
        # snapshot obligation, not a historical monthly payment to add to S.
        payment = loan["loan_monthly_payment"] if loan["loan_status"] in {"C", "D"} else 0
        profile = dict(zip(PROFILE_FIELDS, [
            key, rows[0]["month"], rows[-1]["month"], len(rows), len(recent),
            income, spending, typical["household_bills"], fixed, buffer,
            payment, income - spending, max(spending - income, 0), runway,
            status, str(capped).lower(), loan["loan_id"], loan["loan_status"],
        ]))
        # Calculate with full source precision; round currency only for export.
        for field in PROFILE_FIELDS[5:13]:
            profile[field] = f"{profile[field]:.2f}"
        profile["baseline_runway_months"] = f"{runway:.1f}"
        profiles.append(profile)
    return profiles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build-raw", "process", "all"])
    parser.add_argument("--source-dir", type=Path, default=PROJECT_ROOT / "data/source")
    parser.add_argument("--raw", type=Path, default=PROJECT_ROOT / "data/raw/customer_months.csv")
    parser.add_argument("--processed", type=Path,
                        default=PROJECT_ROOT / "data/processed/customer_profiles.csv")
    args = parser.parse_args()
    try:
        if args.command in {"build-raw", "all"}:
            rows = build_raw(args.source_dir)
            write_rows(args.raw, RAW_FIELDS, rows)
            print(f"Wrote {len(rows):,} account-month rows to {args.raw}")
        if args.command in {"process", "all"}:
            profiles = process_raw(args.raw)
            write_rows(args.processed, PROFILE_FIELDS, profiles)
            print(f"Wrote {len(profiles):,} customer profiles to {args.processed}")
    except (ValueError, OSError) as error:
        parser.exit(1, f"Data pipeline error: {error}\n")


if __name__ == "__main__":
    main()
