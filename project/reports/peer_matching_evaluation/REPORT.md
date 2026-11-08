# Peer matching parameter evaluation

Run date: 2026-11-08. Data: a fresh, read-only snapshot of all 4,500 TigerData `public.account_metrics` accounts. No database records were modified.

## Answer and recommendation

The existing 30% income, 40% fixed-cost, 40% loan-payment and $200 floor settings were engineering heuristics, not results of a previous optimization. They attempted to balance similarity against enough matches. They should not be described as empirically optimal.

I actually ran 810 parameter configurations. Under the explicit coverage and prediction objective below, the best tested setting was **50% income, 60% fixed costs, 60% loan payments, a $400 cost floor, the closest 20 peers, and at least 10 peers**. This improves access to comparisons, especially for accounts with loans. It does **not** establish better prediction accuracy or safer spending cuts. Production parameters were left unchanged: the candidate uses wider similarity ranges and produces less stable medians. Treat it as a coverage-oriented candidate, not a proven replacement.

There is no single data-proven “optimal” setting here. The winner depends on what the product values: coverage, similarity, precision of medians, or identifying genuinely discretionary spending. This experiment measures the first three imperfectly; the database has no labels for the fourth.

## What each original parameter does

| Parameter | Original setting | Reason for the heuristic |
|---|---:|---|
| Income tolerance | ±30% of target income | Keep earning capacity broadly comparable without requiring identical income. |
| Fixed-cost tolerance | ±40% of target fixed costs | Compare recurring obligations while allowing more variation than income. |
| Loan-payment tolerance | ±40% of target loan payments | Compare monthly repayment burden; this does not compare outstanding balances or rates. |
| Cost tolerance floor | $200 | Avoid tiny or zero cost values yielding a nearly zero match window. Actual cost window is `max(percentage × target cost, floor)`. |
| Loan status | Same positive/zero payment status | Avoid matching accounts with ongoing payments to accounts without them. |
| Maximum peers | Closest 50 | Bound the cohort so distant eligible accounts do not dominate it. |
| Minimum peers | 10 | Suppress medians from very small cohorts. This was not a statistical confidence guarantee. |

For example, $1,000 of fixed costs originally permits a $400 difference; $100 permits a $200 difference because of the floor. Tolerances are centered on the selected account and are therefore asymmetric between accounts. Eligible accounts are ranked by the sum of squared differences normalized by these windows. The selected account is excluded. Each reported benchmark is a median of account-level monthly metrics, not a pooled median of individual transactions.

## Reproducible experiment

The accompanying `evaluate_peer_parameters.py` is the code actually executed. It uses Python 3.12.14 and NumPy 2.5.4. The temporary snapshot contains account IDs and financial metrics. It is retained at `/tmp/peer-evaluation/account_metrics_snapshot.csv` for this local experiment and is deliberately excluded from the repository. It contains no credentials or individual transaction records.

Snapshot SHA-256: `f154f64e8391db27a543e1dc514d01b270c64d017ff578a3b4b5e4116ac520eb`.

Accounts were sorted by ID, randomly permuted with seed **20261108**, and split into **2,700 reference accounts, 900 validation accounts, and 900 held-out test accounts**. Validation and test targets only draw peers from the reference set; their own outcomes are not included in peer medians. Exact split IDs are saved in `split_account_ids.npz`.

| Parameter | Values tested |
|---|---|
| Income tolerance | 10%, 20%, 30%, 40%, 50% |
| Fixed-cost tolerance | 20%, 40%, 60% |
| Loan-payment tolerance | 20%, 40%, 60% |
| Cost floor | $0, $200, $400 |
| Maximum peers | 20, 50, 100 |
| Minimum peers | 10, 20 |

This is `5 × 3 × 3 × 3 × 3 × 2 = 810` configurations. Same loan status was held fixed, rather than optimized. Ranking feature weights were also held fixed.

The selection rule was specified in code before running the search: minimize validation total-monthly-spending sMAPE among settings producing a cohort for at least **90% of all accounts, 75% of accounts with loans, and 90% without loans**. These coverage targets are explicit product choices, not learned truths. Only **9** configurations qualified. Ties favor a larger minimum cohort, then a smaller maximum cohort, then the ordered tolerances and floor. The selected configuration was then evaluated on the held-out test set; test results were not used to select it.

For actual spending `a` and peer-median prediction `p`, per-account sMAPE is `200 × |a − p| / (|a| + |p| + 1e-9)` percent, averaged over covered targets. MAE averages `|a − p|` in dollars. These are similarity/prediction proxies, not measures of waste or affordability. Coverage means enough eligible peers exist; it does not mean an account is financially healthy.

## Results

Validation winner: 50% / 60% / 60%, $400 floor, maximum 20, minimum 10. Validation coverage was **96.89%** overall and **77.00%** among accounts with loans, with spending sMAPE **17.65%**. Original settings covered **92.44%** overall but only **46.00%** with loans, failing the loan-coverage requirement. The winner reaches the upper bounds of the tolerance grid: it is the best tested feasible configuration, not a global optimum.

### Held-out test: 900 accounts

| Metric | Original | Selected candidate | Income-only comparator |
|---|---:|---:|---:|
| Accounts receiving a benchmark | 854 / 900 | 892 / 900 | 897 / 900 |
| Overall coverage | 94.89% | 99.11% | 99.67% |
| Coverage among accounts with loans | 56.82% | 90.91% | 98.86% |
| Spending sMAPE | 16.64% | 16.95% | 16.52% |
| Spending MAE | $1,004.55 | $1,089.82 | $986.03 |
| Household-bills sMAPE | 16.00% | 16.43% | 79.87% |
| Cash-withdrawal sMAPE | 45.01% | 45.15% | 52.35% |
| Other-transfer sMAPE | 48.99% | 51.65% | 64.65% |
| Median cohort size | 50 | 20 | 50 |

The income-only comparator retains ±30% income, same loan status, maximum 50 and minimum 10, but drops fixed-cost and loan-amount restrictions and ranks on income alone. It predicts total spending slightly better on its covered subset, yet predicts household bills substantially worse. Optimizing total outflow alone is not sufficient to validate channel-specific suggestions. Card withdrawals had zero test error because that channel was uninformative in this split; that result should not be interpreted as a successful predictive model.

The columns above cover different accounts, so their errors are not a fair paired superiority test. On the **same 854 accounts** covered by both original and selected settings, original spending sMAPE was **16.6353%**, versus **16.5028%** for the candidate. The difference was **−0.1325 percentage points**, with a **95% paired bootstrap interval of −0.6000 to +0.3136 points** from 2,000 resamples. The interval includes zero: there is no clear evidence of an accuracy improvement on this split.

Resampling each cohort 200 times gave a median relative 95% bootstrap interval width for the spending median of **11.16% original versus 15.92% candidate**. Smaller candidate cohorts produced less stable benchmarks. These intervals concern resampling peer medians, not confidence that a user can afford a reduction.

### Coverage with the full database available

After selection, both settings were also checked with each account eligible to match all other 4,499 accounts. This is an operational coverage diagnostic, not held-out prediction validation.

| Metric | Original | Selected candidate |
|---|---:|---:|
| Accounts receiving a benchmark | 4,335 / 4,500 | 4,450 / 4,500 |
| Overall coverage | 96.33% | 98.89% |
| Loan-account coverage | 68.75% | 90.85% |
| Account 20111 peers | 4: benchmark suppressed | 20: benchmark available |
| Account 20133 peers | 50 | 20 |
| Account 20134 peers | 21 | 20 |

This candidate serves **115 additional accounts**, at the cost of looser eligibility and less stable medians. It does not dominate the original configuration on all criteria.

## Verification and limits

A separate parity check compared the experiment's original-setting implementation against `app.peers.compare_peers` for **48 accounts**, checking cohort counts, availability, and all five benchmark medians. All passed within the production display rounding of half a cent.

Only one seeded account split was used. Bootstrap intervals are conditional on that split and do not include parameter-selection uncertainty. This is cross-account prediction of historical metrics, not forecasting future spending. Fixed costs overlap household bills and loan obligations, so good household-bill predictions partly reflect matching on closely related information. Household size, region, dependents, loan principal/rate, and discretionary purchase labels are unavailable. Unobserved household differences can make an above-median amount entirely reasonable. Outflow channels overlap and their gaps must not be added together.

Before deploying a new default, repeat selection across account splits and later snapshots; evaluate a multi-channel objective and explicit similarity limits; and validate proposed cuts with transaction purpose and user confirmation. The present findings support a coverage-oriented candidate and transparent disclosure of the original heuristics, not a claim of universally optimal matching or safe automatic reductions.

## Run it again

From the project's `project` directory:

```sh
./.venv/bin/python scripts/evaluate_peer_parameters.py \
  --input /tmp/peer-evaluation/account_metrics_snapshot.csv \
  --output /tmp/peer-matching-rerun
```

NumPy is required (`python -m pip install numpy==2.5.4` using the same environment if absent). The script is offline and only reads the temporary snapshot. It writes the complete 810-row validation grid, summary JSON with additional channel metrics, and exact split IDs. Rerunning with the temporary snapshot and versions reproduces the experiment without database access. This report was written from those saved outputs; runtime matching settings were not changed.
