import pytest
from fastapi.testclient import TestClient
from app.engine import build_plan,Shock,RecurringCost,OneOffCost
from app.planning import PlanningOptions
from app.shock_parser import ParsedShockSchema,resolve_draft
from app.main import app

BASE={'income':3000,'spending':2600,'buffer':5200,'household_bills':900,'months_of_history':40}

def test_different_effects_expire_and_income_recovers():
    shock=Shock(income_multiplier=.5,income_duration_months=3,scenario_duration_months=6,
        recurring_costs=[RecurringCost('groceries',100,duration_months=2),RecurringCost('rent',200,duration_months=4)],
        one_off_costs=[OneOffCost('repair',500)])
    p=build_plan(BASE,{},shock,planning=PlanningOptions())
    rows=p['monthly_projection']
    assert [m.get('income') for m in rows[1:]]==[1500]*3+[3000]*3
    assert [m.get('spending') for m in rows[1:]]==[2900,2900,2800,2800,2600,2600]
    assert [m['balance'] for m in rows]==[4700,3300,1900,600,800,1200,1600]
    assert p['duration_assessment']['ending_buffer']==1600
    assert p['duration_assessment']['required_starting_buffer']==4600
    assert p['action_plan']['backup']['ending_buffer_after_actions']==1600
    assert p['duration_assessment']['covers_duration']


def test_early_deficit_not_hidden_by_recovery():
    shock=Shock(income_multiplier=0,income_duration_months=1,scenario_duration_months=6)
    p=build_plan({**BASE,'buffer':1000},{},shock,planning=PlanningOptions())
    assert p['duration_assessment']['ending_buffer']>0
    assert not p['duration_assessment']['covers_duration']
    assert p['backup_plan']['monthly_cut_needed']==1600
    b=p['action_plan']['backup']
    assert not b['covers_duration_after_actions'] and b['additional_monthly_improvement_needed']==1600
    assert b['additional_buffer_for_horizon']==1600
    fixed=build_plan({**BASE,'buffer':1000},{},shock,planning=PlanningOptions(confirmed_extra_income=1600))
    assert fixed['action_plan']['backup']['covers_duration_after_actions']


def test_overall_bills_and_spending_have_their_own_duration():
    p=build_plan(BASE,{},Shock(household_bills_pct_change=10,spending_pct_change=10,scenario_duration_months=3,
                            effect_durations={'bills':1,'spending':2}))
    assert [r['spending'] for r in p['monthly_projection'][1:]]==[2950,2860,2600]


def test_parser_preserves_durations_and_resolves_clarification():
    draft=ParsedShockSchema(shock_found=True,income_multiplier=.5,income_duration_months=6,
        category_changes=[{'category':'groceries','pct_change':10,'duration_months':2},{'category':'rent','monthly_delta':200,'duration_months':4}])
    r=resolve_draft(draft,BASE,{'0':500})
    assert r['status']=='ok'
    assert r['shock']['scenario_duration_months']==6
    assert r['shock']['recurring_costs'][0]['duration_months']==2
    assert r['shock']['effect_durations']['category_1']==4
    r=resolve_draft(draft,BASE,{'0':500},duration_months=9,effect_durations={'income':3,'category_0':5})
    assert r['shock']['income_duration_months']==3 and r['shock']['recurring_costs'][0]['duration_months']==5


@pytest.mark.parametrize('durations',[{'income':0},{'income':61},{'income':1.5},{'missing':3}])
def test_invalid_effect_duration_rejected(durations):
    with pytest.raises(ValueError):
        build_plan(BASE,{},Shock(income_multiplier=.5,scenario_duration_months=6,effect_durations=durations))


def test_api_round_trip_and_backup_recalculation():
    with TestClient(app) as c:
        resolved=c.post('/api/resolve-shock',json={'account_id':20134,'draft':{'shock_found':True,
            'category_changes':[{'category':'groceries','monthly_delta':50},{'category':'rent','monthly_delta':100}]},
            'duration_months':6,'effect_durations':{'category_0':2,'category_1':4}})
        assert resolved.status_code==200,resolved.text
        shock=resolved.json()['shock']
        response=c.post('/api/plan',json={'account_id':20134,'shock':shock,'planning':{'confirmed_extra_income':100}})
        assert response.status_code==200,response.text
        p=response.json()
        assert len(p['monthly_projection'])==7
        assert p['monthly_projection'][3]['spending']==8160.52
        assert p['monthly_projection'][5]['spending']==8060.52
        assert p['action_plan']['backup']['monthly_projection_after_actions'][3]['income']==8058
