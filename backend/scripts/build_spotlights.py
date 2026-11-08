"""Refresh the three bundled offline demo account snapshots."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.insights import write_spotlight_snapshots  # noqa: E402


if __name__ == "__main__":
    print(f"Wrote {write_spotlight_snapshots()}")
