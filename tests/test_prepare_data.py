import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "prepare_data", Path(__file__).resolve().parents[1] / "scripts/prepare_data.py"
)
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


class ProfileTests(unittest.TestCase):
    def write_fixture(self, path, rows):
        pipeline.write_rows(path, pipeline.RAW_FIELDS, rows)

    def fixture(self):
        rows = []
        # Reverse chronology catches accidental input-order dependence.
        for month in range(7, 0, -1):
            rows.append(dict(zip(pipeline.RAW_FIELDS, [
                "1", f"2025-{month:02}", 4000, 3500,
                100 if month <= 4 else 1000,
                1000 if month <= 3 else 100,
                100, month * 1000, "9", "C", 100,
            ])))
        return rows

    def test_median_of_monthly_sums_and_last_six_sorted_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "raw.csv"
            self.write_fixture(path, self.fixture())
            p = pipeline.process_raw(path)[0]
        self.assertEqual(p["typical_fixed_costs"], "1200.00")
        self.assertEqual(p["savings_buffer"], "4500.00")
        self.assertEqual(p["active_loan_monthly_payment"], "100.00")
        self.assertEqual(p["typical_monthly_surplus"], "500.00")
        self.assertEqual(p["baseline_runway_status"], "no_shortfall")

    def test_runway_branches_and_cap_are_distinguishable(self):
        self.assertEqual(pipeline.baseline_runway(-1, 200, 300), (0, "buffer_depleted", False))
        self.assertEqual(pipeline.baseline_runway(100, 200, 200), (120, "no_shortfall", False))
        self.assertEqual(pipeline.baseline_runway(1000, 200, 199), (120, "shortfall", True))
        self.assertEqual(pipeline.baseline_runway(1000, 500, 200), (3.3, "shortfall", False))

    def test_duplicate_months_and_conflicting_loans_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "raw.csv"
            rows = self.fixture()
            self.write_fixture(path, rows + [rows[0]])
            with self.assertRaisesRegex(ValueError, "Duplicate account-month"):
                pipeline.process_raw(path)
            rows[0]["loan_status"] = "A"
            self.write_fixture(path, rows)
            with self.assertRaisesRegex(ValueError, "Inconsistent loan snapshot"):
                pipeline.process_raw(path)

    def test_finished_and_absent_loans_have_zero_current_payment(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "raw.csv"
            for loan_id, status, payment in [("9", "A", 100), ("", "", "")]:
                rows = self.fixture()
                for r in rows:
                    r.update(loan_id=loan_id, loan_status=status, loan_monthly_payment=payment)
                self.write_fixture(path, rows)
                self.assertEqual(pipeline.process_raw(path)[0]["active_loan_monthly_payment"], "0.00")


if __name__ == "__main__":
    unittest.main()
