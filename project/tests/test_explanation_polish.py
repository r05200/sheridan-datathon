import json
from app import explainer
from app.engine import build_plan, Shock
from app.planning import PlanningOptions
from conftest import FakeClient

BASE={'income':3000,'spending':2600,'buffer':5200,'household_bills':900,'months_of_history':40}

def plan(base=BASE, **options):
    return build_plan(base,{},Shock(income_multiplier=.55,income_duration_months=6),planning=PlanningOptions(**options))

def test_zero_surplus_is_unreachable_not_uncalculated():
    p=plan({**BASE,'income':2000})
    fallback=explainer.template_explanation(p)
    assert 'cannot be reached' in fallback['goal_plan_text']
    assert 'uncalculated' not in str(fallback)
    assert explainer.validate(fallback,p)[0]
    bad={**fallback,'goal_plan_text':'Reaching the target will take an uncalculated time.'}
    assert explainer.validate(bad,p)[0] is None
    bad={**fallback,'goal_plan_text':'Your target will take time.'}
    assert explainer.validate(bad,p)[0] is None

def test_model_receives_selected_goal_and_revised_backup():
    p=plan(monthly_contribution=200,confirmed_monthly_cut=100)
    client=FakeClient(explainer.template_explanation(p))
    out=explainer.explain_plan(p,client=client,use_cache=False)
    assert out['source']=='gemini'
    sent=json.loads(client.calls[0]['user'])
    assert sent['action_plan']['goal']['monthly_contribution']==200
    assert sent['action_plan']['goal']['months_to_goal']==13
    assert sent['action_plan']['backup']['covers_duration_after_actions'] is True
    assert 'covers 6 months' in out['backup_plan_text']
    assert '$100' in json.dumps(sent)
    assert 'months_to_goal null' in client.calls[0]['system']

def test_fallback_explains_remaining_gap_after_confirmed_actions():
    p=plan(confirmed_monthly_cut=50)
    out=explainer.template_explanation(p)
    assert '$33.34' in out['backup_plan_text']
    assert explainer.validate(out,p)[0]
