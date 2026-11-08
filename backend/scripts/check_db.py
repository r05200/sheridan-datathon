"""Connection check: lists each table with its row count, how many accounts are filled in, and whether the
database columns match app/db/schema.py (what the SQLAlchemy services select).

Usage (from backend/): python scripts/check_db.py   (connection from backend/.env)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sqlalchemy import func, inspect, select  # noqa: E402

from app.db import DatabaseError, services, session_scope  # noqa: E402
from app.db.schema import metadata  # noqa: E402
from app.db.services._common import run  # noqa: E402

if __name__ == "__main__":
    try:
        with session_scope() as s:
            for t in metadata.sorted_tables:
                print(f"{t.name:18s}{run(s, select(func.count()).select_from(t)).scalar_one():>10,} rows")
            print(f"{'baseline filled':18s}{len(services.get_all_baselines(s)):>10,} accounts")
            live = inspect(s.connection()).get_columns("account_metrics")
        drift = {c["name"] for c in live} ^ {c.name for c in metadata.tables["account_metrics"].columns}
        if drift:
            sys.exit(f"Columns differ from schema.py: {sorted(drift)}. Run: python scripts/setup_db.py --reset")
        print("columns match schema.py")
    except DatabaseError as e:
        sys.exit(f"Connection failed: {e}")
