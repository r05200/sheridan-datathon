# Tangerine resilience engine — backend (Gemini: Plan Explainer + Shock Parser)

Python 3.10+ / FastAPI. Code computes; Gemini only translates (see the PRD).

```
app/engine.py        runway, shock, goal plan, backup plan  -> the Explainer's input JSON
app/db/              the only DB package (Tiger Data/Postgres, SQLAlchemy 2.0): read-only, parameterized
  config.py          build_engine(config): 5 s connect + statement timeouts, read-only transactions
  session.py         engine singleton, session_scope(), get_session() (FastAPI dependency)
  schema.py          account_metrics: one row per account, one column per value the frontend displays
  errors.py          AccountNotFound, NoHistory, DatabaseUnavailable
  types.py           frozen dataclasses returned by services (money as float)
  services/          fetch-only functions, Session first: get_account_snapshot, list_account_ids, ...
app/gemini_client.py shared client: configurable total budget, 1 retry, logging, JSON mode, temperature 0
app/explainer.py     Part 1: Gemini explain -> number validation -> retry -> template fallback -> cache
app/shock_parser.py  Part 2: text -> slider values, range validation, visible assumptions
app/main.py          POST /api/plan, /api/explain, /api/parse-shock; GET /api/accounts/{id}/baseline
```

## Run
```
cd backend
pip install -r requirements.txt
cp .env.example .env            # add GEMINI_API_KEY / DATABASE_URL (never commit .env)
uvicorn app.main:app --reload
```
With no Gemini key, explanations come from the template and the parser returns "Couldn't read that, please use
the sliders." There is no offline database fallback: if the database is not configured or unreachable, account
endpoints return 503.

## Database setup (Tiger Data)
```
python scripts/setup_db.py /path/to/data --dry-run   # compute from the CSVs and summarize; no database
python scripts/setup_db.py /path/to/data             # create account_metrics if missing, replace its rows
python scripts/setup_db.py /path/to/data --reset     # drop and recreate first (after a schema change)
python scripts/check_db.py                           # row count and how many accounts are filled in
```
`/path/to/data` needs `monthly_summary.csv` and `loans.csv` (default `$TANGERINE_DATA_DIR` or `~/Downloads/data`).
Connection comes from `backend/.env` (git-ignored; real environment variables win). Either one string,
`DATABASE_URL=postgres://user:password@host:port/dbname?sslmode=require`, or separate `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE` (default `require`). The two forms are not combined: a `DATABASE_URL` is used exactly as written.

The only table is `account_metrics`: one row per account (4,500), one column per number the frontend
displays. Baseline values follow the judges' definitions at full precision (`app/baseline_calc.py`); runway
and goal-plan values are produced by the plan engine itself with no shock (`app/account_metrics.py`), so the
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
