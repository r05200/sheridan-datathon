# Tangerine: customer data pipeline

This pipeline creates the data for the challenge's **Know the customer** requirement.
It uses Python 3.10+ and the standard library; no packages or API keys are needed.

## Two data layers

1. `data/raw/customer_months.csv`: 185,326 account-month rows, containing only
   the source fields needed for customer calculations. Loan snapshot fields are
   attached by account ID. There are no calculated financial metrics in this file.
2. `data/processed/customer_profiles.csv`: 4,500 account profiles, with the
   official baseline calculations. This is the CSV the frontend should load.

The first CSV is a **curated source extract**, rather than an untouched original.
Keep the organizer's original CSVs separately. We retain monthly observations
because medians and the last-six-row buffer cannot be computed from a single
summed row per account.

## Run

From the repository root, build both files from the organizer's folder:

```sh
python3 pipeline/prepare_data.py all --source-dir /Users/maggiewu/Downloads/Tangerine/data
```

Alternatively, copy the organizer's CSVs into `data/source/` and run:

```sh
python3 pipeline/prepare_data.py all
```

To regenerate only the processed data (reads only the unified raw CSV):

```sh
python3 pipeline/prepare_data.py process
```

Each stage can also be run independently:

```sh
python3 pipeline/prepare_data.py build-raw --source-dir /path/to/organizer/data
python3 pipeline/prepare_data.py process --raw data/raw/customer_months.csv
python3 -m unittest discover -s pipeline/tests -v
```

Paths default to this project even when the script is invoked from elsewhere.
Generated CSVs are ignored by Git by default. Review the organizer's data-sharing
terms before including source or generated account data in a public repository.

## Unified source schema

| Column | Meaning |
| --- | --- |
| `account_id`, `month` | Unique account-month key, sorted by account then month |
| `money_in`, `money_out` | Recorded monthly inflow and outflow |
| `household_bills`, `insurance`, `loan_payments` | Recorded monthly fixed-cost categories |
| `avg_daily_balance` | Average balance for that month |
| `loan_id`, `loan_status`, `loan_monthly_payment` | End-of-2025 loan snapshot; blank if no loan |

Loan fields repeat across an account's months. They are lookup metadata: **do not
sum them**. `loan_payments` is actual monthly transaction outflow; the separate
`loan_monthly_payment` is the contractual payment in the loan snapshot.

`accounts.csv` validates that every account has history, `monthly_summary.csv`
supplies monthly observations, and `loans.csv` supplies at most one loan per
account. Transactions, clients, cards, standing orders, and districts are excluded
because they are unnecessary for these calculations and could duplicate rows in
a blanket join.

## Processed calculations

All medians use the account's **entire observed monthly history**. Only the buffer
uses the last six rows, sorted chronologically. All money values are CAD.

| Output | Definition |
| --- | --- |
| `typical_monthly_money_in` (I) | Median `money_in` |
| `typical_monthly_spending` (S) | Median `money_out` |
| `typical_household_bills` (H) | Median `household_bills` |
| `typical_fixed_costs` (F) | Median of each month's `household_bills + insurance + loan_payments` |
| `savings_buffer` (B) | Mean `avg_daily_balance` over the last six monthly rows |
| `active_loan_monthly_payment` (P) | Snapshot payment for status C/D; zero for A/B or no loan |
| `typical_monthly_surplus` | I - S; may be negative |
| `monthly_shortfall` | max(S - I, 0) |
| `baseline_runway_months` | 0 if B <= 0; 120 if S - I <= 0; otherwise min(B / (S - I), 120), rounded to one decimal |
| `baseline_runway_status` | `buffer_depleted`, `no_shortfall`, or `shortfall` |
| `baseline_runway_capped` | `true` only when a positive shortfall produces more than 120 months |

`first_month`, `last_month`, `months_observed`, and `buffer_months_used` describe
the available history. `loan_id` and `loan_status` preserve the loan context.

Display `no_shortfall` as **No shortfall (120+)**, not as a finite 120-month
prediction. A capped positive-shortfall result is different. Buffer depletion
takes precedence even if inflows exceed spending, matching the challenge formula.

Calculations use unrounded source values; currency exports have two decimals and
runway has one. For future shock calculations, reuse full-precision monthly data
or extend this script's calculation layer rather than relying on rounded profiles
at threshold boundaries.

## Interpretation and checks

- `money_in` is recorded inflow, not verified salary. The buffer is the challenge's
  balance proxy, not a verified total of the customer's savings across banks.
- The loan snapshot is as of end-2025 even when an account's last month is earlier.
- Spending already includes fixed-cost and loan-payment outflows. Do not add F or
  P to S again. A zero recorded category does not establish no real-world expense.
- Missing numeric fields, invalid months, non-finite values, duplicate keys,
  unknown accounts, multiple loans per account, and conflicting loan metadata
  cause a clear error rather than silently producing a profile.
- Shock scenarios and goal plans are the next stage; they are not baseline fields.

Definitions: organizer's `Tangerine/README.md`, Resilience Rewired, Sheridan
Datathon 2026. Original data credit: PKDD'99 Discovery Challenge Financial dataset,
CTU Prague Relational Dataset Repository: https://relational.fel.cvut.cz/dataset/Financial.
