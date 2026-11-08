"""Check the actual TigerData account_metrics table (never the offline fallback)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db

if __name__ == "__main__":
    try:
        counts = db.table_counts()
        # Verify the complete column contract even when the table is empty.
        db._query(f"SELECT {', '.join(db.EXPORT_COLUMNS)} FROM {db.METRICS_TABLE} LIMIT 1")
    except Exception as e:
        sys.exit(f"TigerData check failed ({type(e).__name__}). Check DATABASE_URL and public.account_metrics schema.")
    total = counts['account_metrics']
    print(f"TigerData public.account_metrics: {total:,} accounts")
    print("Required baseline, loan-payment and spending-breakdown columns verified.")
    if total != 4500:
        sys.exit("Expected 4,500 accounts from the challenge dataset.")
