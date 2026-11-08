import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import engine, explainer
from app.planning import PlanningOptions, build_action_plan

BASE={'income':3000,'spending':2600,'household_bills':900,'buffer':5200}


def make(base=BASE, income=1650, spending=2600, one_off=0, duration=6, **options):
    return build_action_plan(base,income,spending,one_off,duration,PlanningOptions(**options))


def test_goal_uses_existing_buffer_surplus_deadline_and_whole_months():
    g=make()['goal']
    assert g['target_amount']==7800
    assert g['amount_still_needed']==2600
    assert g['available_monthly_saving']==400
    assert g['monthly_contribution']==400
    assert g['months_to_goal']==7
    assert g['monthly_saving_for_deadline']==216.67
    assert g['deadline_affordable_from_surplus']
    assert g['monthly_cash_flow_improvement_for_deadline']==0


def test_custom_goal_and_contribution_are_reflected_in_legacy_explanation_values():
    p=engine.build_plan(BASE,{},engine.Shock(),planning=PlanningOptions(target_months=6,monthly_contribution=200))
    assert p['goal_plan']['target_months_of_spending']==6
    assert p['goal_plan']['target_amount']==15600
    assert p['goal_plan']['monthly_savings_capacity']==200
    assert p['goal_plan']['months_to_goal']==52
    assert p['action_plan']['goal']['monthly_cash_flow_improvement_for_deadline']==466.67


def test_deficit_goal_identifies_total_change_not_just_savings_contribution():
    g=make(base={**BASE,'income':2000})['goal']
    assert g['status']=='no_surplus' and g['months_to_goal'] is None
    assert g['baseline_monthly_surplus']==-600
    assert g['monthly_saving_for_deadline']==216.67
    assert g['monthly_cash_flow_improvement_for_deadline']==816.67


def test_already_funded_and_negative_buffer():
    assert make(base={**BASE,'buffer':9000})['goal']['status']=='target_met'
    g=make(base={**BASE,'buffer':-100})['goal']
    assert g['amount_still_needed']==7900 and g['progress_pct']==0


def test_confirmed_cut_changes_backup_from_gap_to_covered():
    old=make()['backup'];new=make(confirmed_monthly_cut=100)['backup']
    assert old['additional_monthly_improvement_needed']==83.34
    assert not old['covers_duration_after_actions']
    assert new['spending_after_actions']==2500
    assert new['ending_buffer_after_actions']==100
    assert new['covers_duration_after_actions'] and new['additional_buffer_for_horizon']==0
    assert new['additional_monthly_improvement_needed']==0


def test_immediate_gap_cannot_be_hidden_by_later_surplus():
    b=make(income=3000,one_off=6000)['backup']
    assert b['remaining_immediate_funding_gap']==800
    assert b['ending_buffer_after_actions']>0
    assert not b['covers_duration_after_actions']
    assert b['status']=='immediate_funding_gap'


def test_upfront_funding_and_recurring_actions_are_counted_once():
    b=make(one_off=6000,confirmed_upfront_funds=800,confirmed_monthly_cut=950)['backup']
    assert b['buffer_after_expense']==-800
    assert b['remaining_immediate_funding_gap']==0
    assert b['ending_buffer_after_actions']==0
    assert b['covers_duration_after_actions']
    b=make(confirmed_extra_income=100)['backup']
    assert b['income_after_actions']==1750
    assert b['ending_buffer_after_actions']==100


def test_no_duration_does_not_invent_finite_coverage():
    b=make(duration=None)['backup']
    assert b['covers_duration_after_actions'] is None
    assert b['status']=='needs_duration'
    assert b['additional_monthly_improvement_needed']==950


@pytest.mark.parametrize('options',[
    {'monthly_contribution':401},{'monthly_contribution':0},
    {'confirmed_monthly_cut':2601},{'confirmed_extra_income':float('nan')},
    {'confirmed_upfront_funds':-1},{'target_months':0},{'deadline_months':0}
])
def test_infeasible_and_invalid_planning_inputs_are_rejected(options):
    with pytest.raises(ValueError):make(**options)


def test_api_planning_and_explanation_contract(monkeypatch):
    with TestClient(app) as c:
        p=c.post('/api/plan',json={'account_id':20134,'shock':{'income_multiplier':0,'income_duration_months':3},
            'planning':{'target_months':6,'deadline_months':24,'confirmed_monthly_cut':100}})
        assert p.status_code==200
        body=p.json()
        assert body['action_plan']['goal']['target_months']==6
        assert body['action_plan']['backup']['spending_after_actions']==7960.52
        assert body['after_shock']['spending']==8061  # original shock remains unchanged
        received={}
        def explain(plan):
            received.update(plan)
            return {'summary':'original explainer input contract'}
        monkeypatch.setattr(explainer,'explain_plan',explain)
        assert c.post('/api/explain',json=body).status_code==200
        assert received['action_plan'] == body['action_plan']
        bad=c.post('/api/plan',json={'account_id':20134,'planning':{'monthly_contribution':1}})
        assert bad.status_code==422  # this account has no baseline surplus
