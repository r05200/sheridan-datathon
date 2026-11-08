import pytest
from fastapi.testclient import TestClient
from app import shock_parser as sp
from app.main import app
from app.engine import Shock, RecurringCost, build_plan
from conftest import FakeClient

BASE = {'income': 4000, 'spending': 3500, 'household_bills': 1500, 'buffer': 10000}


def draft(**kw):
    return sp.ParsedShockSchema(shock_found=True, **kw)


def test_missing_grocery_budget_blocks_executable_shock():
    d = draft(category_changes=[{'category': 'groceries', 'pct_change': 10}], scenario_duration_months=6)
    r = sp.resolve_draft(d, BASE)
    assert r['status'] == 'needs_input' and r['shock'] is None
    assert r['questions'][0]['kind'] == 'monthly_cost'
    r = sp.resolve_draft(d, BASE, {'0': 500})
    assert r['status'] == 'ok' and r['shock']['recurring_costs'][0]['monthly_change'] == 50
    assert r['shock']['recurring_costs'][0]['source'] == 'user_estimate'


def test_engine_adds_only_category_increase_not_whole_budget():
    p = build_plan(BASE, {}, Shock(recurring_costs=[RecurringCost('groceries', 50)], scenario_duration_months=6))
    assert p['after_shock']['spending'] == 3550
    assert p['duration_assessment']['months'] == 6


def test_direct_delta_and_replacement_cost():
    delta = sp.resolve_draft(draft(category_changes=[{'category':'rent','monthly_delta':200}], scenario_duration_months=6), BASE)
    assert delta['shock']['recurring_costs'][0]['monthly_change'] == 200
    d = draft(category_changes=[{'category':'rent','new_monthly_cost':2000}], scenario_duration_months=6)
    assert sp.resolve_draft(d, BASE)['status'] == 'needs_input'
    r = sp.resolve_draft(d, BASE, {'0':1500})
    assert r['shock']['recurring_costs'][0]['monthly_change'] == 500


def test_category_decrease_and_zero_cost_are_valid():
    d = draft(category_changes=[{'category':'groceries','pct_change':-10}], scenario_duration_months=6)
    assert sp.resolve_draft(d, BASE, {'0':500})['shock']['recurring_costs'][0]['monthly_change'] == -50
    assert sp.resolve_draft(d, BASE, {'0':0})['shock']['recurring_costs'][0]['monthly_change'] == 0


@pytest.mark.parametrize('bad', [-1, float('nan'), float('inf'), 1000001])
def test_invalid_estimates_rejected(bad):
    d = draft(category_changes=[{'category':'groceries','pct_change':10}], scenario_duration_months=6)
    with pytest.raises(ValueError):
        sp.resolve_draft(d, BASE, {'0':bad})


def test_duration_and_overlap_need_answers():
    d = draft(spending_pct_change=10, category_changes=[{'category':'groceries','pct_change':10,'current_monthly_cost':500}])
    r = sp.resolve_draft(d, BASE)
    assert {q['kind'] for q in r['questions']} == {'duration','confirmation'}
    assert sp.resolve_draft(d, BASE, duration_months=6, overlap_acknowledged=True)['status'] == 'ok'
    with pytest.raises(ValueError, match='overlap'):
        build_plan(BASE, {}, Shock(spending_pct_change=10, recurring_costs=[RecurringCost('groceries',50)]))


def test_bad_category_operation_and_conflicting_duration_rejected():
    with pytest.raises(ValueError, match='exactly one'):
        sp.resolve_draft(draft(category_changes=[{'category':'rent','pct_change':10,'monthly_delta':100}]), BASE)
    with pytest.raises(ValueError, match='same duration'):
        sp.resolve_draft(draft(income_multiplier=.55,income_duration_months=6), BASE, duration_months=3)


def test_parser_backstop_never_uses_total_spending_for_groceries():
    r = sp.parse_shock('Groceries rise 10% for 6 months', BASE,
                       FakeClient({'shock_found':True,'spending_pct_change':10,'scenario_duration_months':6}))
    assert r['status']=='needs_input' and r['shock'] is None
    assert r['draft']['spending_pct_change'] is None
    assert r['draft']['category_changes'][0]['pct_change'] == 10


def test_estimates_resolved_locally_not_sent_to_model():
    c=FakeClient({'shock_found':True,'category_changes':[{'category':'groceries','pct_change':10}]})
    r=sp.parse_shock('Groceries go up 10%', BASE, c)
    sp.resolve_draft(sp.ParsedShockSchema.model_validate(r['draft']), BASE, {'0':500}, 6)
    assert len(c.calls)==1 and '500' not in c.calls[0]['user']


def test_api_ui_and_clarification_to_plan_flow():
    with TestClient(app) as client:
        assert client.get('/').status_code==200
        assert client.get('/static/app.js').status_code==200
        assert len(client.get('/api/accounts').json()['account_ids'])==4500
        d=draft(category_changes=[{'category':'groceries','pct_change':10}], scenario_duration_months=6)
        r=client.post('/api/resolve-shock',json={'account_id':20134,'draft':d.model_dump()}).json()
        assert r['status']=='needs_input' and r['shock'] is None
        r=client.post('/api/resolve-shock',json={'account_id':20134,'draft':d.model_dump(),'category_amounts':{'0':500}}).json()
        p=client.post('/api/plan',json={'account_id':20134,'shock':r['shock']})
        assert p.status_code==200 and p.json()['after_shock']['spending']==8111
        assert client.post('/api/explain',json=p.json()).status_code==200
        assert client.post('/api/resolve-shock',json={'account_id':20134,'draft':d.model_dump(),'category_amounts':{'0':-5}}).status_code==422
        assert client.post('/api/plan',json={'account_id':20134,'shock':{'recurring_costs':[{'label':'groceries','monthly_change':50}],'spending_pct_change':10}}).status_code==422


def test_strict_local_fallback_only_for_supported_full_phrases():
    from app.gemini_client import GeminiError
    c = FakeClient(GeminiError('unavailable'))
    r = sp.parse_shock('Grocery prices go up 10% for 6 months.', BASE, c)
    assert r['status']=='needs_input' and r['parser_source']=='local_rules'
    assert 'local rules' in r['assumptions'][0]
    assert r['shock'] is None
    assert sp.parse_shock('Grocery prices go up 10% and income drops 50%', BASE, c)['status']=='error'
