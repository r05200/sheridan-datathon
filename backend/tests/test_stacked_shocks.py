"""Stacked scenarios: each part applies only for its own duration, assessed month by month."""
import pytest

from app.finance.engine import RecurringCost, Shock, build_plan
from app.finance.planning import PlanningOptions
from app.main import ShockModel

BASE = {"income": 3000, "spending": 2600, "buffer": 5200, "household_bills": 900, "months_of_history": 40}
FLEX = {"card_withdrawals": 420}

# No income for 2 months, plus +$400/month of costs for 4 months.
JOB_LOSS = Shock(income_multiplier=0, income_duration_months=2)
COSTS = Shock(recurring_costs=[RecurringCost("Childcare", 400)], scenario_duration_months=4)


def test_each_part_applies_only_for_its_own_window():
    p = build_plan(BASE, FLEX, Shock(parts=[JOB_LOSS, COSTS]), planning=PlanningOptions())
    d = p["duration_assessment"]
    # Months 1-2: 0 in, 3000 out. Months 3-4: 3000 in, 3000 out. Deepest point: -6000.
    assert d["months"] == 4
    assert d["buffer_path"] == [5200, 2200, -800, -800, -800]
    assert d["required_starting_buffer"] == 6000      # not 4 x 3000 = 12000 if both lasted 4 months
    assert d["additional_buffer_needed"] == 800
    assert d["ending_buffer"] == -800
    assert d["covers_duration"] is False
    # Month 1 is the snapshot: every part in effect.
    assert p["after_shock"]["income"] == 0 and p["after_shock"]["spending"] == 3000
    # A flat cut of 400/month keeps the buffer at zero or above through month 2, the worst point.
    assert p["backup_plan"]["monthly_cut_needed"] == 400
    backup = p["action_plan"]["backup"]
    assert backup["additional_monthly_improvement_needed"] == 400
    assert backup["additional_buffer_for_horizon"] == 800
    assert backup["ending_buffer_after_actions"] == -800
    assert backup["covers_duration_after_actions"] is False
    assert p["shock"]["label"] == "Income at 0% of normal for 2 months; Childcare +400/month (user_estimate) for 4 months"


def test_confirmed_cut_covers_stacked_horizon():
    p = build_plan(BASE, FLEX, Shock(parts=[JOB_LOSS, COSTS]), planning=PlanningOptions(confirmed_monthly_cut=400))
    backup = p["action_plan"]["backup"]
    assert backup["covers_duration_after_actions"] is True
    assert backup["status"] == "covered"
    assert backup["ending_buffer_after_actions"] == 800      # 5200 - 2 x 2600 + 2 x 400


def test_parts_sharing_one_window_match_the_single_shock():
    single = Shock(income_multiplier=0.55, income_duration_months=6, household_bills_pct_change=10,
                   scenario_duration_months=6)
    stacked = Shock(parts=[Shock(income_multiplier=0.55, income_duration_months=6),
                           Shock(household_bills_pct_change=10, scenario_duration_months=6)])
    a = build_plan(BASE, FLEX, single, planning=PlanningOptions())
    b = build_plan(BASE, FLEX, stacked, planning=PlanningOptions())
    for key in ("after_shock", "duration_assessment", "backup_plan", "goal_plan", "action_plan"):
        assert a[key] == b[key]


def test_permanent_part_lasts_the_whole_horizon():
    p = build_plan(BASE, FLEX, Shock(parts=[JOB_LOSS, Shock(household_bills_pct_change=100)]))
    # Months 1-2: 0 in, 3500 out; months 3+: 3000 in, 3500 out, over a 2-month horizon.
    assert p["duration_assessment"]["months"] == 2
    assert p["duration_assessment"]["required_starting_buffer"] == 7000


def test_each_part_is_still_validated_on_its_own():
    bad = Shock(household_bills_pct_change=10, recurring_costs=[RecurringCost("Rent", 200)])
    with pytest.raises(ValueError, match="overlap"):
        build_plan(BASE, FLEX, Shock(parts=[JOB_LOSS, bad]))


def test_api_model_accepts_parts_but_not_nesting():
    m = ShockModel(parts=[{"income_multiplier": 0, "income_duration_months": 2},
                          {"recurring_costs": [{"label": "Childcare", "monthly_change": 400}],
                           "scenario_duration_months": 4}])
    shock = m.to_engine()
    assert len(shock.parts) == 2 and shock.parts[1].window == 4
    with pytest.raises(ValueError):
        ShockModel(parts=[{"parts": [{"income_multiplier": 0}]}])
