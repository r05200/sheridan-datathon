import copy
import time

import pytest

from app.finance import engine
from app.ai import explainer
from app.db import services
from app.finance.engine import NO_SHORTFALL, OneOffCost, Shock, build_plan
from app.ai.gemini_client import GeminiClient, GeminiError
from conftest import FakeClient

BASE = {"income": 3000, "spending": 2600, "buffer": 5200, "household_bills": 900, "months_of_history": 40}
FLEX = {"card_withdrawals": 420, "cash_withdrawals": 150, "transfers_out_other": 110}
PLAN = build_plan(BASE, FLEX, Shock(income_multiplier=0.55, income_duration_months=6))

GOOD = {"summary": "Runway means how many months your savings would last. Your $5,200 savings would last 5.5 months.",
        "goal_plan_text": "Saving $400 a month gets you to $7,800 in 6.5 months.",
        "backup_plan_text": "The required reduction is $84 a month; affordability needs confirmation.",
        "caveat": "Withdrawals may pay for essentials; affordability is unconfirmed."}


# ---- the PRD's required cases -------------------------------------------------------------
def test_no_shortfall_case():
    p = build_plan(BASE, FLEX, Shock(income_multiplier=0.95))
    t = explainer.template_explanation(p)
    assert "absorb" in t["summary"] and "120" not in str(t) and "no_shortfall" not in str(t)


def test_zero_buffer_case_leads_with_backup_plan():
    p = build_plan({**BASE, "buffer": 0}, FLEX, Shock(income_multiplier=0.5))
    t = explainer.template_explanation(p)
    assert "already gone" in t["summary"] and "backup plan" in t["summary"]


def test_low_confidence_case():
    p = build_plan({**BASE, "months_of_history": 14}, FLEX, Shock(income_multiplier=0.55))
    t = explainer.template_explanation(p)
    assert "rougher" in t["caveat"]
    clean, why = explainer.validate({**GOOD, "caveat": ""}, p)
    assert clean is None and "caveat" in why                       # Gemini must include the caveat


def test_cuts_not_sufficient_case():
    p = build_plan({**BASE, "buffer": 0}, {"card_withdrawals": 10, "cash_withdrawals": 0, "transfers_out_other": 0},
                   Shock(income_multiplier=0.5, income_duration_months=6))
    t = explainer.template_explanation(p)
    assert "unconfirmed" in t["caveat"]


def test_unverified_cuts_have_affordability_caveat():
    assert "unconfirmed" in explainer.template_explanation(PLAN)["caveat"]


# ---- number validation --------------------------------------------------------------------
def test_good_output_validates():
    clean, why = explainer.validate(GOOD, PLAN)
    assert clean and not why


def test_invented_number_is_rejected():
    bad = {**GOOD, "summary": "Your savings would last about 7 months."}
    clean, why = explainer.validate(bad, PLAN)
    assert clean is None and "numbers not in input: [7.0]" in why
    assert explainer.invalid_numbers({"s": "Savings last 5.6 months, or $1,700."}, PLAN) == [5.6, 1700.0]


def test_rounded_differently_is_rejected():
    assert explainer.invalid_numbers({"s": "about 5 months"}, PLAN) == [5.0]


def test_over_long_field_is_rejected():
    clean, why = explainer.validate({**GOOD, "summary": "word " * 130}, PLAN)
    assert clean is None and "too long" in why
    clean, why = explainer.validate({**GOOD, "goal_plan_text": "word " * 80}, PLAN)
    assert clean is None and "too long" in why


def test_stray_caveat_is_blanked_when_not_needed():
    no_cut_plan = build_plan(BASE, FLEX, Shock())
    clean, _ = explainer.validate({**explainer.template_explanation(no_cut_plan), "caveat": "Be careful."}, no_cut_plan)
    assert clean["caveat"] == ""


def test_summary_uses_account_data():
    p = build_plan({**BASE, "fixed_costs": 1200, "loan_payment": 300}, FLEX, Shock(income_multiplier=0.55))
    assert p["account"] == {"household_bills": 900, "fixed_costs": 1200, "loan_payment": 300, "months_of_history": 40}
    s = explainer.template_explanation(p)["summary"]
    for text in ("$1,200 in fixed costs", "$300 in loan payments", "$900 a month", "40 months of history"):
        assert text in s, (text, s)


def test_missing_field_rejected():
    assert explainer.validate({"summary": "x"}, PLAN)[0] is None


# ---- orchestration: gemini -> retry -> template -------------------------------------------
def test_uses_gemini_when_valid_and_never_sends_account_id():
    c = FakeClient(GOOD)
    plan = {
        **PLAN,
        "account_id": 1234,
        "account_context": {
            "historical_observations": ["Recent recorded spending is materially elevated."],
            "limitation": "Historical observations are context only.",
        },
    }
    out = explainer.explain_plan(plan, client=c)
    assert out["source"] == "gemini" and out["summary"] == GOOD["summary"]
    assert "1234" not in c.calls[0]["user"] and "account_id" not in c.calls[0]["user"]
    assert "Recent recorded spending is materially elevated" in c.calls[0]["user"]


def test_retries_once_on_invalid_then_succeeds():
    c = FakeClient({**GOOD, "summary": "Lasts 99 months."}, GOOD)
    assert explainer.explain_plan(PLAN, client=c)["source"] == "gemini" and len(c.calls) == 2


def test_falls_back_to_template_after_two_invalid():
    c = FakeClient({**GOOD, "summary": "Lasts 99 months."})
    out = explainer.explain_plan(PLAN, client=c)
    assert out["source"] == "template" and len(c.calls) == 2


def test_falls_back_when_api_errors():
    out = explainer.explain_plan(PLAN, client=FakeClient(GeminiError("boom")))
    assert out["source"] == "template"


def test_works_with_gemini_disabled():
    assert explainer.explain_plan(PLAN)["source"] == "template"        # conftest disables Gemini


def test_cache_hit_skips_gemini_and_template_is_not_cached():
    c = FakeClient(GOOD)
    explainer.explain_plan(PLAN, client=c)
    again = explainer.explain_plan({**PLAN, "account_id": 5}, client=c)   # account id is not part of the key
    assert again["source"] == "cache" and len(c.calls) == 1
    explainer.clear_cache()
    explainer.explain_plan(PLAN, client=FakeClient(GeminiError("x")))
    assert explainer.explain_plan(PLAN, client=FakeClient(GOOD))["source"] == "gemini"


def test_hung_api_returns_template_within_budget(monkeypatch):
    monkeypatch.setattr("app.ai.config.gemini_disabled", lambda: False)
    client = GeminiClient(timeout_s=0.3)
    monkeypatch.setattr(client, "_call", lambda *a: time.sleep(3) or "{}")
    t0 = time.monotonic()
    out = explainer.explain_plan(PLAN, client=client, total_budget_s=0.3)
    assert out["source"] == "template" and time.monotonic() - t0 < 1.0


# ---- acceptance: 50 accounts x 3 shocks, template output only uses input numbers ------------
SHOCKS = [
    Shock(income_multiplier=0.55, income_duration_months=6),
    Shock(household_bills_pct_change=15, one_off_costs=[OneOffCost("furnace repair", None, 1)]),
    Shock(income_multiplier=0, income_duration_months=3, spending_pct_change=10),
]


def test_template_numbers_all_appear_in_input_for_50_accounts_x_3_shocks(session):
    ids = sorted(services.get_all_baselines(session))[::90][:50]
    assert len(ids) == 50
    checked = 0
    for acct in ids:
        for shock in SHOCKS:
            plan = engine.plan_for_account(session, acct, shock)
            t = explainer.template_explanation(plan)
            assert explainer.invalid_numbers(t, plan) == [], (acct, shock, t)
            clean, why = explainer.validate(t, plan)
            assert clean, (acct, why, t)                                # template satisfies its own rules
            assert all(len(v.split()) <= (100 if k == "summary" else 60) for k, v in t.items())
            assert t["summary"].startswith("Normally ")                  # leads with the account context
            checked += 1
    assert checked == 150
