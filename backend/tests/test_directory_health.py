"""Directory health badge: buffer coverage in months of spending, plus the sign of monthly cash flow."""
from app.insights import _health_band


def test_health_bands():
    assert _health_band({"income": 4000, "spending": 3000, "buffer": 9000}) == "healthy"
    assert _health_band({"income": 2000, "spending": 3000, "buffer": 9000}) == "watch"     # negative cash flow
    assert _health_band({"income": 4000, "spending": 3000, "buffer": 3000}) == "watch"     # 1 to 3 months
    assert _health_band({"income": 4000, "spending": 3000, "buffer": 2999}) == "at_risk"
    assert _health_band({"income": 0, "spending": 0, "buffer": 100}) == "healthy"         # nothing to cover
    assert _health_band({"income": 0, "spending": 0, "buffer": 0}) == "at_risk"
