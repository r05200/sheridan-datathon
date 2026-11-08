"""Challenge formula and funding-feasibility regressions."""
from dataclasses import asdict

import pytest

from app.ai import explainer
from app.db import services
from app.finance.engine import OneOffCost, Shock, build_plan, runway


BASE = {"income": 3000, "spending": 2600, "buffer": 5200,
        "household_bills": 900, "months_of_history": 40}
FLEX = {"cash_withdrawals": 2000, "card_withdrawals": 0, "transfers_out_other": 0}


@pytest.mark.parametrize("buffer,income,spending,expected", [
    (0, 3000, 2600, 0), (-100, 3000, 2600, 0),
    (1, 3000, 2600, "no_shortfall"), (1, 2600, 2600, "no_shortfall"),
    (10000, 3000, 3001, 120), (120, 3000, 3001, 120), (119, 3000, 3001, 119),
])
def test_official_runway_branch_order_and_cap(buffer, income, spending, expected):
    assert runway(buffer, income, spending) == expected


def test_repair_exhausting_buffer_is_not_absorbable_even_without_monthly_gap():
    p = build_plan(BASE, FLEX, Shock(one_off_costs=[OneOffCost("repair", 6000)]))
    assert p["after_shock"]["runway_months"] == 0
    assert p["backup_plan"]["upfront_funding_needed"] == 800
    assert p["backup_plan"]["cuts_sufficient"] is False
    t = explainer.template_explanation(p)
    assert "absorb" not in t["summary"]
    assert "$800" in t["backup_plan_text"]


def test_upfront_deficit_cannot_be_fixed_by_monthly_cuts_alone():
    p = build_plan(BASE, FLEX, Shock(income_multiplier=.55, income_duration_months=6,
                                   one_off_costs=[OneOffCost("repair", 6000)]))
    assert p["backup_plan"]["upfront_funding_needed"] == 800
    assert p["duration_assessment"]["additional_buffer_needed"] == 6500
    assert not p["duration_assessment"]["covers_duration"]
    assert p["backup_plan"]["cuts_sufficient"] is False


def test_recommended_cut_actually_covers_horizon():
    p = build_plan(BASE, FLEX, Shock(income_multiplier=.55, income_duration_months=6))
    cut = p["backup_plan"]["monthly_cut_needed"]
    assert cut == 84  # 83 would leave a $2 deficit after six months.
    assert BASE["buffer"] - 6 * (950 - cut) >= 0
    assert p["backup_plan"]["cuts_sufficient"] is None


def test_exact_duration_boundary_and_one_cent_shortfall():
    shock = Shock(income_multiplier=.55, income_duration_months=6)
    at = build_plan({**BASE, "buffer": 5700}, FLEX, shock)
    below = build_plan({**BASE, "buffer": 5699.99}, FLEX, shock)
    assert at["duration_assessment"]["covers_duration"]
    assert at["duration_assessment"]["ending_buffer"] == 0
    assert not below["duration_assessment"]["covers_duration"]
    assert below["duration_assessment"]["additional_buffer_needed"] == 1


def test_one_off_summary_uses_remaining_buffer():
    p = build_plan(BASE, FLEX, Shock(income_multiplier=.55,
                                   one_off_costs=[OneOffCost("repair", 1000)]))
    text = explainer.template_explanation(p)["summary"]
    assert "$4,200 remaining buffer" in text and "$5,200" not in text


def test_capped_runway_is_explained_as_a_lower_bound():
    p = build_plan({**BASE, "income": 2599}, FLEX, Shock())
    assert p["after_shock"]["runway_capped"]
    assert "at least 120 months" in explainer.template_explanation(p)["summary"]


def test_goal_not_claimed_reached_when_small_positive_time_rounds_to_zero():
    p = build_plan({**BASE, "buffer": 7799.99}, FLEX, Shock())
    assert p["goal_plan"]["months_to_goal"] == .1
    assert "already have" not in explainer.template_explanation(p)["goal_plan_text"]


def test_all_accounts_match_independent_reference_for_example_shocks(session):
    for account, baseline in services.get_all_baselines(session).items():
        base = {k: v for k, v in asdict(baseline).items() if k != "account_id"}
        for shock in [Shock(), Shock(income_multiplier=.55, income_duration_months=6),
                      Shock(household_bills_pct_change=15),
                      Shock(income_multiplier=.55, household_bills_pct_change=15,
                            one_off_costs=[OneOffCost("repair", multiple_of_monthly_spending=1)])]:
            income = base["income"] * (shock.income_multiplier if shock.income_multiplier is not None else 1)
            spending = base["spending"] + (shock.household_bills_pct_change or 0) / 100 * base["household_bills"]
            buffer = base["buffer"] - (base["spending"] if shock.one_off_costs else 0)
            expected = (0 if buffer <= 0 else "no_shortfall" if spending <= income
                        else round(min(buffer / (spending - income), 120), 1))
            p = build_plan(base, {}, shock, account)
            assert p["after_shock"]["runway_months"] == expected, account


def test_database_views_keep_full_precision_for_every_account(session, data_dir):
    from app.finance.baseline_calc import compute_baselines

    reference = compute_baselines(data_dir).set_index("account_id")
    for account, values in services.get_all_baselines(session).items():
        for field in ("income", "spending", "household_bills", "fixed_costs", "buffer"):
            assert getattr(values, field) == pytest.approx(reference.loc[account, field], abs=1e-8, rel=0)
