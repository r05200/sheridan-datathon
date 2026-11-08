"""LEGACY raw-CSV loader; not the current TigerData account_metrics importer.

Do not run this against the current TigerData service. It targets the historical raw schema.
Create tables, load the CSVs, and create the account_baseline reference view in Postgres.

Usage: DATABASE_URL=... python scripts/load_csvs.py /path/to/data
(transactions.csv is not loaded; ~100 MB, only add it if a feature needs it.)
"""
import sys
from pathlib import Path

import psycopg2

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"
TABLES = ["districts", "accounts", "loans", "monthly_summary"]

if __name__ == "__main__":
    import os

    if len(sys.argv) != 2 or not os.getenv("DATABASE_URL"):
        sys.exit(__doc__)
    data = Path(sys.argv[1])
    conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=10)
    with conn, conn.cursor() as cur:
        cur.execute((SQL_DIR / "schema.sql").read_text())
        for t in TABLES:
            cur.execute(f"TRUNCATE {t}")
            with (data / f"{t}.csv").open() as f:
                cur.copy_expert(f"COPY {t} FROM STDIN WITH (FORMAT csv, HEADER true)", f)
            print("loaded", t)
        cur.execute((SQL_DIR / "account_baseline.sql").read_text())
    print("done")
