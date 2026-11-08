"""Connection check: prints row counts and compares with the brief."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db  # noqa: E402

EXPECTED = {"monthly_summary": 185_326, "loans": 682, "accounts": 4_500}

if __name__ == "__main__":
    try:
        counts = db.table_counts()
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Connection failed: {e}")
    bad = False
    for t, n in counts.items():
        want = EXPECTED.get(t)
        flag = "" if want is None or want == n else f"  <-- expected {want}"
        bad |= bool(flag)
        print(f"{t:16s}{n:>10,}{flag}")
    n_view = len(db.get_all_baselines())
    print(f"{'account_baseline':16s}{n_view:>10,}")
    sys.exit(1 if bad else 0)
