# Tangerine resilience engine — backend (Gemini: Plan Explainer + Shock Parser)

Python 3.10+ / FastAPI. Code computes; Gemini only translates (see the PRD).

```
app/main.py          FastAPI routes: POST /api/plan, /api/explain, /api/parse-shock; GET /api/accounts/{id}/baseline
app/finance/         the numbers (no AI, no database access except engine reading services)
  engine.py          runway, shock, goal plan, backup plan  -> the Explainer's input JSON
  planning.py        action plans, goal and funding plans
  baseline_calc.py   judges' baseline definitions at full precision (pandas, from the CSVs)
  account_metrics.py every account_metrics row (baseline + no-shock plan values) for the database load
app/ai/              Gemini: it only translates, code computes
  config.py          env settings (GEMINI_API_KEY, model, timeout, explain-cache path)
  gemini_client.py   shared client: configurable total budget, 1 retry, logging, JSON mode, temperature 0
  explainer.py       Part 1: Gemini explain -> number validation -> retry -> template fallback -> cache
  shock_parser.py    Part 2: text -> slider values, range validation, visible assumptions
app/db/              the only DB package (Tiger Data/Postgres, SQLAlchemy 2.0): read-only, parameterized
  config.py          build_engine(config): 5 s connect + statement timeouts, read-only transactions
  session.py         engine singleton, session_scope(), get_session() (FastAPI dependency)
  schema.py          account_metrics: one row per account, one column per value the frontend displays
  errors.py          AccountNotFound, NoHistory, DatabaseUnavailable
  types.py           frozen dataclasses returned by services (money as float)
  services/          fetch-only functions, Session first: get_account_snapshot, list_account_ids, ...
```

## Run
One-time setup:
```
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # add GEMINI_API_KEY / DATABASE_URL (never commit .env)
cd .. && npm install            # installs the React frontend (frontend/) and the dev runner
```
Then, from the repository root:
```
npm start          # backend on :8000 (uvicorn --reload) + React dev server; open http://localhost:5173
npm run serve      # build frontend/dist and serve the app and the API together on http://localhost:8000
```
`scripts/run-api.mjs` runs uvicorn from `backend/` using `backend/.venv` when it exists (else `python3`).
The backend alone still runs with `uvicorn app.main:app --reload` from `backend/`.
With no Gemini key, explanations come from the template and the parser returns "Couldn't read that, please use
the sliders." There is no automatic database fallback: if the database is not configured or unreachable, account
endpoints return 503 (set `DB_DISABLED=1` to serve the SQL backup instead; see below).

## Database setup (Tiger Data)
```
python scripts/setup_db.py /path/to/data --dry-run   # compute from the CSVs and summarize; no database
python scripts/setup_db.py /path/to/data             # create account_metrics if missing, replace its rows
python scripts/setup_db.py /path/to/data --reset     # drop and recreate first (after a schema change)
python scripts/check_db.py                           # row count and how many accounts are filled in
python scripts/setup_db.py /path/to/data --sql sql/account_metrics.sql   # SQL backup; no database
psql "$DATABASE_URL" -f sql/account_metrics.sql      # restore the backup (drops and recreates the table)
```
Offline mode: set `DB_DISABLED=1` in `backend/.env` and the server serves `sql/account_metrics.sql` from an
in-memory SQLite database instead of Tiger Data (`/api/health` shows `"database": "backup"`). It is only used
when you ask for it; with `DB_DISABLED=0` a down database still returns 503. Regenerate the file after data changes.

`/path/to/data` needs `monthly_summary.csv` and `loans.csv` (default `$TANGERINE_DATA_DIR` or `~/Downloads/data`).
Connection comes from `backend/.env` (git-ignored; real environment variables win). Either one string,
`DATABASE_URL=postgres://user:password@host:port/dbname?sslmode=require`, or separate `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE` (default `require`). The two forms are not combined: a `DATABASE_URL` is used exactly as written.

The only table is `account_metrics`: one row per account (4,500), one column per number the frontend
displays. Baseline values follow the judges' definitions at full precision (`app/finance/baseline_calc.py`); runway
and goal-plan values are produced by the plan engine itself with no shock (`app/finance/account_metrics.py`), so the
stored numbers match the live app. Shock-dependent values are never stored. Loading takes about a second and
runs in one transaction, so a failed run leaves the existing rows untouched. If the table's columns no longer
match `app/db/schema.py`, the script stops and asks for `--reset`.

## Gemini
`python scripts/gemini_smoke.py` (one test call) · `python scripts/pregenerate.py <account ids>` (cache demo accounts)

## Tests
```
pytest                          # Gemini faked; database tests skip without TEST_DATABASE_URL
RUN_LIVE=1 pytest -m live -s    # 30 phrasings against the real API (needs GEMINI_API_KEY)
```
Set `TANGERINE_DATA_DIR` if the CSVs are not in `~/Downloads/data` (CSV-based tests skip otherwise).
Database tests run against a local Postgres; the CSVs are loaded on first use (`TEST_DB_RELOAD=1` forces it):
```
docker run -d --rm --name tangerine-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16
TEST_DATABASE_URL="postgresql://postgres:pg@127.0.0.1:55432/postgres?sslmode=disable" pytest
```
`TANGERINE_DATA_DIR` selects the directory containing `monthly_summary.csv` and `loans.csv`; by default the
app uses the repository's `data/` directory. Account profiles are read from `backend/data/customer_profiles.csv`.
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
- The database views return full source-derived precision (double precision);
  round only API display values.

Remaining scope: category-specific grocery/rent assumptions and independent shock
timelines still require parser/UI work. These calculation corrections do not make
those interpretations data-supported.

## Web app and category estimates

The React frontend lives in `../frontend` (Vite). In development `npm start` serves it on :5173 and
proxies `/api` and `/docs` to this backend. After `npm run build`, this backend serves `frontend/dist` at `/`.
The UI includes account search, baseline metrics,
chat input, scenario review, clarification forms, before/after comparison,
funding/goal/backup plans, explanation and a full-data inspector. Manual controls
work without Gemini. Each new query describes a complete replacement scenario;
chat history is not sent as conversational memory.

The account baseline also returns historical stress signals, recent-versus-typical
inflow and balance comparisons, an income-quartile/pension peer band, an EI-55%
comparison for pension-majority accounts, and an eligible-only never-negative
watchlist rank. It includes a six-month reverse stress test (maximum income loss the
buffer can cover, plus the extra buffer needed at 50% income retention), a spending
drift flag comparing the latest three months with those same months one year earlier,
and a latest month-end balance comparison with the official six-month average buffer.
These are scenario and historical signals, not forecasts.

`POST /api/plan` also attaches a short `account_context` containing applicable
historical flags. Gemini may use these as qualitative context for the explanation;
the deterministic plan calculations do not use or change based on those flags.

The Accounts view includes a portfolio scenario overview from
`GET /api/tangerine/portfolio`. It reports baseline counts and applies three
illustrative twists: income retained at 55%, that income scenario plus household
bills up 15%, and an immediate repair cost equal to one month of typical spending.
Runway is rounded to one decimal before cohort counts are calculated. The
55%-income scenario is not an Employment Insurance eligibility estimate; all
portfolio counts describe the relabelled Czech source data, not Canadian customers.
The account page visualizes the last 12 months of inflows, outflows, and month-end
balances, with progress indicators for selected historical measures.
`GET /api/tangerine/accounts?filter=all` returns all 4,500 accounts;
filters include `troubled_loans_healthy`, `no_loan_negative`, `negative`, and
`watchlist`. `GET /api/tangerine/spotlights` serves three frozen account snapshots
for offline demos. Rebuild them after changing source data with
`python scripts/build_spotlights.py`.

The watchlist is a relative, equal-weight ranking of low latest balance, low
three-month surplus, and falling balance. It is not a probability, is withheld
for accounts with any observed negative-balance month, and its retrospective
six-month holdout is a small, single test rather than a forecast. The interface
shows its top-5% hit rate and comparison to lowest-surplus-only at the same list
size. All diagnostics are based on relabelled PKDD'99 Berka history; districts
are Czech, groceries are not a recorded field, and category budgets and one-off
prices are supplied by the user.

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
