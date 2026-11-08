"""Run offline evaluation of the experimental loan-risk ranking."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.default_risk import main


if __name__ == "__main__":
    main()
