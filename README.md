# Cushion: Tangerine financial resilience (Sheridan Datathon 2026)

## Layout

```
backend/     FastAPI API (Python): engine, Gemini explainer/parser, database layer   -> backend/README.md
  sql/         SQL backup of the database (account_metrics.sql)
  scripts/     setup_db.py (load / back up the database), check_db.py, gemini_smoke.py, pregenerate.py
  tests/       pytest suite
frontend/    React + Vite web app (src/, public/ images); builds to frontend/dist
pipeline/    Standalone customer-data pipeline (prepare_data.py + tests)          -> pipeline/README.md
scripts/     run-api.mjs: starts the backend for the npm scripts below
```

## One-time setup

```sh
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # fill in GEMINI_API_KEY and DATABASE_URL (or set DB_DISABLED=1, see below)
cd ..
npm install                   # frontend dependencies + dev runner
```

## Run

From the repository root:

```sh
npm start         # backend on :8000 (auto-reload) + frontend dev server -> open http://localhost:5173
npm run serve     # build the frontend, then serve app + API together -> open http://localhost:8000
```

Separately, in two terminals:

```sh
npm run dev:api   # backend only (uvicorn on :8000)
npm run dev:web   # frontend only (Vite on :5173, proxies /api to :8000)
```

No database connection? Set `DB_DISABLED=1` in `backend/.env` and the backend serves the data from
`backend/sql/account_metrics.sql` instead.

## Tests

```sh
cd backend && .venv/bin/python -m pytest              # backend
python3 -m unittest discover -s pipeline/tests -v     # data pipeline
```
