# Tangerine resilience engine — backend (Gemini: Plan Explainer + Shock Parser)

Python 3.10+ / FastAPI. Code computes; Gemini only translates (see the PRD).

```
app/engine.py        runway, shock, goal plan, backup plan  -> the Explainer's input JSON
app/db.py            the only DB module (Tiger Data/Postgres) + offline fallback export
app/gemini_client.py shared client: configurable total budget, 1 retry, logging, JSON mode, temperature 0
app/explainer.py     Part 1: Gemini explain -> number validation -> retry -> template fallback -> cache
app/shock_parser.py  Part 2: text -> slider values, range validation, visible assumptions
app/main.py          POST /api/plan, /api/explain, /api/parse-shock; GET /api/accounts/{id}/baseline
sql/                 legacy raw-CSV schema and baseline-view reference (not used by the live app)
data/account_baseline.csv   offline export used when the database is unreachable (committed)
```

## Run
```
cd project
pip install -r requirements.txt
cp .env.example .env            # add GEMINI_API_KEY / DATABASE_URL (never commit .env)
uvicorn app.main:app --reload
```
With no keys set it still works: baselines come from the offline export, explanations from the template, and the
parser returns "Couldn't read that, please use the sliders."

## Database setup (TigerData)

The live app reads `public.account_metrics` in TigerData using the PostgreSQL driver.
Set `DATABASE_URL` to your TigerData service connection URL (including `sslmode=require`)
and `DB_DISABLED=0` in `project/.env`. No separate SQL database or baseline view is required.

The table must include `account_id`, `income`, `spending`, `household_bills`, `fixed_costs`,
`buffer`, `months_of_history`, `loan_payment`, `card_withdrawals`, `cash_withdrawals`, and
`transfers_out_other`. The engine still computes scenario and goal results itself.

```bash
./.venv/bin/python scripts/check_db.py
./.venv/bin/python -m uvicorn app.main:app --reload --port 8001
```

The checker queries TigerData directly and verifies the columns and 4,500-account count.
The historical `scripts/load_csvs.py` and `sql/` files describe the old raw-CSV schema;
they do not create the current `account_metrics` table and should not be run against the
current TigerData service. `scripts/export_baseline.py /path/to/data` builds the local
`data/account_baseline.csv` fallback. Its filename is retained for offline compatibility.
Use `DB_DISABLED=1` only when intentionally running from this local export.

## Gemini
`python scripts/gemini_smoke.py` (one test call) · `python scripts/pregenerate.py <account ids>` (cache demo accounts)

## Tests
```
pytest                          # offline; Gemini faked
RUN_LIVE=1 pytest -m live -s    # 30 phrasings against the real API (needs GEMINI_API_KEY)
```
Set `TANGERINE_DATA_DIR` if the CSVs are not in `~/Downloads/data` (CSV-based tests skip otherwise).
Offline dry run: `GEMINI_DISABLED=1 DB_DISABLED=1 uvicorn app.main:app` with the network off.

## Calculation contract

- Runway follows the brief: remaining buffer <= 0 returns 0 first; otherwise
  nonpositive shortfall returns `no_shortfall`; positive-shortfall runway is capped
  at 120 months. `runway_capped` distinguishes capped values from exact durations.
- `after_shock.buffer` is always the remaining balance after immediate costs.
- `backup_plan.upfront_funding_needed` identifies immediate costs/debt that the
  starting buffer cannot cover. Future monthly cuts cannot finance this upfront.
- Required whole-dollar cuts/funding targets round upward. Goal time rounds upward
  to one decimal, so a small remaining goal is not incorrectly marked complete.
  Other displayed amounts round to whole dollars; calculations retain precision.
- `backup_plan.cuts_sufficient` is `true` when no cuts or upfront funding are
  needed, `false` when monthly cuts alone cannot work, and `null` when a cut is
  mathematically required but affordability needs confirmation. The historical
  withdrawal/transfer categories are not verified discretionary budgets.
- When `income_duration_months` is supplied, `duration_assessment` reports the
  required starting buffer, additional buffer needed, ending balance and whether
  the account covers that horizon. All entered changes are held constant during
  this assessment; there is no simulation of recovery or expenses after it ends.
- Offline exports retain full source-derived precision. Refresh with
  `python scripts/export_baseline.py /path/to/data`; round only API display values.

Remaining scope: category-specific grocery/rent assumptions and independent shock
timelines still require parser/UI work. These calculation corrections do not make
those interpretations data-supported.

## Web app and category estimates

Start the backend normally and open `http://127.0.0.1:8000/` for the local web UI.
There is no frontend build step. The UI includes account search, baseline metrics,
chat input, scenario review, clarification forms, before/after comparison,
funding/goal/backup plans, explanation and a full-data inspector. Manual controls
work without Gemini. Each new query describes a complete replacement scenario;
chat history is not sent as conversational memory.

Specific categories such as groceries/rent never automatically use total spending
or the household-bills aggregate. `POST /api/parse-shock` may return `needs_input`
with a draft and typed questions; `shock` is null until clarification is complete.
Submit the draft to `POST /api/resolve-shock` with `category_amounts` keyed by the
category's zero-based index, an optional `duration_months`, and explicit
`overlap_acknowledged` if relevant. This stage runs locally, without another model
call. A successful response returns the executable shock for `/api/plan`.

For a grocery increase of 10% and a user-estimated existing budget of $500, the
engine adds only $50/month to recorded spending. It does not add $550 or infer a
customer's grocery budget from cash withdrawals. A new cost (rent becomes $2,000)
requires the old cost; an explicit change (rent increases $200) does not.
All category amounts are labelled user estimates. If no duration is given for a
category shock, the UI asks. All changes share the assessment horizon; different
start/end dates require separate scenarios for now. Vague amounts must be
rephrased. Broad and category changes require overlap acknowledgement before
being added together. Negative resulting total spending is rejected.

The engine accepts `recurring_costs` as `{label, monthly_change, source}` entries
and `scenario_duration_months` for non-income scenarios. `/api/accounts` lists
available IDs. The numerical endpoints remain available in `/docs`.

If Gemini is unavailable, exact category-percentage phrases such as "Grocery prices go up 10% for 6 months" use a labelled local-rule fallback. Compound or ambiguous failed requests are not approximated; manual controls remain available.


## Gemini model and latency

`GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`; `GEMINI_TIMEOUT_S` defaults to 20
seconds (valid range 1-120), including retries. Flash-Lite requests use minimal thinking and the model's default temperature. Transport responses must satisfy the schema;
missing extraction containers and empty shock extractions are not accepted as a
successful interpretation. Model-unavailable, credential, quota and timeout errors
show actionable messages rather than being disguised as a wording problem.

A priced purchase can be proposed as an immediate one-off cost only with an
explicit upfront-payment assumption for review. Financing without payment terms
must be clarified. For example, "bought a car for 20000$" should propose a
$20,000 one-off payment; it must not silently produce an empty scenario.

After changing `.env`, stop the server and restart it. If an older model was
exported in your terminal, run `unset GEMINI_MODEL GEMINI_TIMEOUT_S GEMINI_DISABLED`
first so the local `.env` supplies the settings. Credentials belong only in `.env`.


## Query-to-calculation request path

The parser uses one direct HTTP JSON request to Gemini with a compact instruction
and the user's text. It does not upload customer records or a large nested provider
schema. There are no hidden SDK retries; the returned JSON is validated locally
before it can become calculator inputs. The verified default model is
`gemini-3.5-flash-lite`, with a 20-second upper bound and minimal thinking.

Live checks verified: `bought a car for 20000$` returns a $20,000 one-off cost;
55%-income plus 15%-bills maps to the corresponding variables; a 10% grocery
increase asks for a monthly budget. Each query remains a complete scenario.


## Income clarification (no automatic EI)

Job loss alone does not assume 55% replacement income or a six-month duration.
The parser returns `needs_input` with `income_percentage` and/or `duration`
questions. Enter 0 for no income, or a user-supplied replacement percentage. Only
explicit EI-at-55% input maps to 0.55. Missing duration is requested for any income
change, including explicitly zero income. Clarification answers are resolved
locally via `income_replacement_pct` and `duration_months` on `/api/resolve-shock`.
Existing one-off costs and other changes are retained. Re-enter old chat requests
after refreshing the page; old interpretation cards retain their original inputs.


## Make a plan

`POST /api/plan` now accepts optional `planning` inputs: `target_months` (default 3),
`deadline_months` (default 12), `monthly_contribution` (blank means available baseline
surplus), `confirmed_monthly_cut`, `confirmed_extra_income`, and
`confirmed_upfront_funds` (all default zero). These are editable planning choices,
not values inferred from the dataset. The response adds `action_plan.goal` and
`action_plan.backup`; existing explanation fields and the explanation prompt remain
intact. The new action-plan object is excluded from the explainer's input.

Goal calculations show the emergency-fund target, remaining amount, baseline saving
capacity, selected monthly contribution, whole-month completion time, and the cash
flow change needed to meet the chosen deadline. A negative baseline surplus must
first be restored before saving. Contributions above the current surplus are
rejected rather than presented as affordable. Required amounts round up to cents.

Backup calculations apply only user-confirmed reductions, extra income and upfront
funds to the shock. They keep the original scenario unchanged and separately show
remaining immediate funding, monthly shortfall, required further improvement,
spending ceiling, end balance and horizon coverage. Immediate funding and future
monthly changes are not interchangeable. Upfront gaps must be covered at the start;
a positive later balance alone does not establish coverage. Without a duration,
finite coverage is unknown. Cash withdrawals are never presumed cuttable.

The web app displays editable goal and backup cards under **Make a plan**. New shocks
reset backup actions; the normal-budget goal preferences stay with the account until
another account is loaded. Plans assume constant cash flow, no interest, no new
borrowing and no automatic post-shock recovery. No transactions are executed.

## Separate change durations

Scenario review offers one duration per recurring change and an overall viewing period,
all between 1 and 60 months. All changes begin in month 1. After a change expires, that
component returns to its baseline amount; this includes income, so confirm recovery timing
with the customer. One-off expenses are deducted once, before month 1.

API: use `shock.effect_durations` keys `income`, `bills`, `spending`, and `category_0`,
`category_1`, etc. in recurring-cost order. Recurring-cost entries may also specify
`duration_months`. The viewing period is `scenario_duration_months` and must include all
selected durations. An unspecified component duration lasts the viewing period.
`monthly_projection` contains the actual monthly income, spending, net change and balance.
The comparison runway is explicitly a constant month-one reference, not the depletion
time of the varying scenario. Funding requirements and coverage check every monthly
balance, including any early deficit followed by later recovery. Backup actions apply
throughout the viewing period; `monthly_projection_after_actions` shows their effect.
Legacy scenarios with a single shared duration retain their original calculation contract.

## Customer goals and peer benchmarks

The default 3-month fund and 12-month deadline are editable starting suggestions.
Customers can instead specify `planning.target_amount_override` (positive dollars,
up to $1,000,000); this overrides the months-of-spending target. Required saving,
progress and timeline use the selected target. Contributions cannot exceed the
account's observed normal monthly surplus.

`GET /api/accounts/{id}/peers` compares account-level metrics from TigerData's
`public.account_metrics` (or the local baseline export when offline). The target
account is excluded. Candidates must have the same positive/zero loan-payment
status and fall within 30% of income and 40% of fixed costs and loan payments
(with a $200 cost tolerance floor). Sum-of-squared normalized distances ranks
candidates; the closest 50 are retained. Fewer than 10 matches suppress benchmarks.
These thresholds are transparent product heuristics, not validated affordability
ratings. Only aggregate medians and sample counts are returned.

Benchmarks include total spending, household bills, cash withdrawals, card withdrawals
and other outgoing transfers. They use medians of the accounts' monthly metrics,
not pooled transaction purchases. Total and channel gaps overlap and must not be
summed. Above-median values trigger review suggestions, not automatic cuts or
claims that expenses are discretionary. Customers choose any feasible reduction
and explicitly enter it into the backup budget before recalculating. Matching
does not account for household size, location, loan balances or interest rates.
