"""Write the offline fallback export (backend/data/account_baseline.csv) from the CSVs.

Usage: python scripts/export_baseline.py /path/to/data
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config  # noqa: E402
from app.baseline_calc import compute_baselines  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    df = compute_baselines(Path(sys.argv[1]))
    df.round(2).to_csv(config.OFFLINE_BASELINE_PATH, index=False)
    print(f"Wrote {len(df)} accounts to {config.OFFLINE_BASELINE_PATH}")
