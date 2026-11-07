# Tangerine resilience engine — backend (Gemini: Plan Explainer + Shock Parser)

Python / FastAPI. Code computes; Gemini only translates (see the PRD).

```
app/engine.py        runway, shock, goal plan, backup plan  -> the Explainer's input JSON
app/db.py            the only DB module (Tiger Data/Postgres) + offline fallback export
app/gemini_client.py shared client: 4s total budget, 1 retry, logging, JSON mode, temperature 0
app/explainer.py     Part 1: Gemini explain -> number validation -> retry -> template fallback -> cache
app/shock_parser.py  Part 2: text -> slider values, range validation, visible assumptions
app/main.py          POST /api/plan, /api/explain, /api/parse-shock; GET /api/accounts/{id}/baseline
sql/                 schema.sql, account_baseline.sql (the view)
data/account_baseline.csv   offline export used when the database is unreachable (committed)
```

## Run
```
cd backend
pip install -r requirements.txt
cp .env.example .env            # add GEMINI_API_KEY / DATABASE_URL (never commit .env)
uvicorn app.main:app --reload
```
With no keys set it still works: baselines come from the offline export, explanations from the template, and the
parser returns "Couldn't read that, please use the sliders."

## Database setup (Tiger Data)
```
DATABASE_URL=... python scripts/load_csvs.py /path/to/data   # tables, \copy-style load, view
DATABASE_URL=... python scripts/check_db.py                   # row counts vs brief (185,326 / 682 / 4,500)
python scripts/export_baseline.py /path/to/data               # refresh the offline export
```

## Gemini
`python scripts/gemini_smoke.py` (one test call) · `python scripts/pregenerate.py <account ids>` (cache demo accounts)

## Tests
```
pytest                          # offline; Gemini faked
RUN_LIVE=1 pytest -m live -s    # 30 phrasings against the real API (needs GEMINI_API_KEY)
```
Set `TANGERINE_DATA_DIR` if the CSVs are not in `~/Downloads/data` (CSV-based tests skip otherwise).
Offline dry run: `GEMINI_DISABLED=1 DB_DISABLED=1 uvicorn app.main:app` with the network off.
