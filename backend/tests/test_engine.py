import pytest

from app.finance.engine import NO_SHORTFALL, OneOffCost, Shock, build_plan

BASE = {"income": 3000, "spending": 2600, "buffer": 5200, "household_bills": 900, "months_of_history": 40}
FLEX = {"card_withdrawals": 420, "cash_withdrawals": 150, "transfers_out_other": 110}


def test_prd_example_is_reproduced_exactly():
    p = build_plan(BASE, FLEX, Shock(income_multiplier=0.55, income_duration_months=6))
    assert p["baseline"] == {"income": 3000, "spending": 2600, "buffer": 5200, "runway_months": NO_SHORTFALL, "runway_capped": False}
    assert p["after_shock"] == {"income": 1650, "spending": 2600, "monthly_gap": 950, "runway_months": 5.5, "buffer": 5200, "runway_capped": False}
    assert p["goal_plan"] == {"target_months_of_spending": 3, "target_amount": 7800,
                              "monthly_savings_capacity": 400, "months_to_goal": 6.5}
    assert p["backup_plan"]["monthly_cut_needed"] == 84
    assert p["backup_plan"]["cuts_sufficient"] is None
    assert p["flags"] == {"low_confidence": False, "reason": None}


def test_no_shortfall_after_small_shock():
    p = build_plan(BASE, FLEX, Shock(income_multiplier=0.95))
    assert p["after_shock"]["runway_months"] == NO_SHORTFALL
    assert p["backup_plan"]["monthly_cut_needed"] == 0


def test_bills_shock_uses_household_bills_not_all_spending():
    p = build_plan(BASE, FLEX, Shock(household_bills_pct_change=10))
    assert p["after_shock"]["spending"] == 2690          # 2600 + 10% of 900


def test_one_off_cost_comes_out_of_buffer():
    p = build_plan(BASE, FLEX, Shock(income_multiplier=0.55, one_off_costs=[OneOffCost("furnace", None, 1)]))
    assert p["after_shock"]["one_off_costs"] == 2600
    assert p["after_shock"]["buffer"] == 2600
    assert p["after_shock"]["runway_months"] == 2.7      # 2600 / 950


def test_zero_buffer_runway_is_zero():
    p = build_plan({**BASE, "buffer": 0}, FLEX, Shock(income_multiplier=0.5))
    assert p["baseline"]["runway_months"] == 0
    assert p["after_shock"]["runway_months"] == 0


def test_negative_buffer_is_treated_as_zero_runway():
    p = build_plan({**BASE, "buffer": -500}, FLEX, Shock(income_multiplier=0.5))
    assert p["after_shock"]["runway_months"] == 0


def test_cuts_not_sufficient():
    p = build_plan({**BASE, "buffer": 0}, {"card_withdrawals": 10, "cash_withdrawals": 0, "transfers_out_other": 0},
                   Shock(income_multiplier=0.5, income_duration_months=6))
    assert p["backup_plan"]["cuts_sufficient"] is None


def test_low_confidence_on_short_history():
    p = build_plan({**BASE, "months_of_history": 14}, FLEX, Shock())
    assert p["flags"]["low_confidence"] is True and "14" in p["flags"]["reason"]


def test_goal_already_met_and_unreachable():
    assert build_plan({**BASE, "buffer": 9000}, FLEX, Shock())["goal_plan"]["months_to_goal"] == 0
    assert build_plan({**BASE, "income": 2000}, FLEX, Shock())["goal_plan"]["months_to_goal"] is None


def test_empty_shock_label():
    assert build_plan(BASE, FLEX, Shock())["shock"]["label"] == "No shock"
