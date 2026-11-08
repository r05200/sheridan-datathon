"""Connection check: lists each table with its row count and how many accounts are filled in.

Usage (from backend/): python scripts/check_db.py   (connection from backend/.env)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sqlalchemy import func, select  # noqa: E402

from app.db import DatabaseError, services, session_scope  # noqa: E402
from app.db.schema import metadata  # noqa: E402
from app.db.services._common import run  # noqa: E402

if __name__ == "__main__":
    try:
        with session_scope() as s:
            for t in metadata.sorted_tables:
                print(f"{t.name:18s}{run(s, select(func.count()).select_from(t)).scalar_one():>10,} rows")
            print(f"{'baseline filled':18s}{len(services.get_all_baselines(s)):>10,} accounts")
    except DatabaseError as e:
        sys.exit(f"Connection failed: {e}")
