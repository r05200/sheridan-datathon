import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import shock_parser as sp
from conftest import FakeClient


def test_old_model_defaults_are_removed_and_other_changes_preserved():
    raw={'shock_found':True,'income_multiplier':.55,'income_duration_months':6,
         'scenario_duration_months':6,'one_off_costs':[{'label':'car','amount_dollars':20000}],
         'assumptions':['Applied default income multiplier of 0.55','Applied default duration of 6 months']}
    r=sp.parse_shock('i got laid off from my job and i just bought a 20,000$ car',client=FakeClient(raw))
    assert r['status']=='needs_input' and r['shock'] is None
    assert r['draft']['income_multiplier'] is None and r['draft']['income_duration_months'] is None
    assert r['assumptions']==[]
    with TestClient(app) as client:
        response=client.post('/api/resolve-shock',json={'account_id':20134,'draft':r['draft'],
                             'income_replacement_pct':0,'duration_months':3})
        resolved=response.json()
        assert resolved['status']=='ok'
        assert resolved['shock']['income_multiplier']==0
        assert resolved['shock']['income_duration_months']==3
        assert resolved['shock']['one_off_costs'][0]['amount_dollars']==20000
        plan=client.post('/api/plan',json={'account_id':20134,'shock':resolved['shock']}).json()
        assert plan['after_shock']['income']==0
        assert plan['after_shock']['one_off_costs']==20000


def test_explicit_zero_and_explicit_ei_are_preserved():
    for text,value in [('Lost my job, no income for 3 months',0),
                       ('Laid off, EI pays 55% of income for 6 months',.55)]:
        months=3 if value==0 else 6
        r=sp.parse_shock(text,client=FakeClient({'shock_found':True,'income_multiplier':value,
                                               'income_duration_months':months}))
        assert r['status']=='ok' and r['shock']['income_multiplier']==value


def test_explicit_income_missing_duration_asks_without_guessing():
    r=sp.parse_shock('Income falls 30%',client=FakeClient({'shock_found':True,'income_multiplier':.7}))
    assert r['status']=='needs_input'
    assert [q['kind'] for q in r['questions']]==['duration']


def test_bills_percentage_does_not_establish_replacement_income():
    r=sp.parse_shock('I got laid off and household bills rise 15%',client=FakeClient({
        'shock_found':True,'income_multiplier':.55,'household_bills_pct_change':15}))
    assert r['status']=='needs_input' and r['draft']['income_multiplier'] is None


@pytest.mark.parametrize('value',[-1,151])
def test_invalid_replacement_percent_rejected(value):
    with TestClient(app) as client:
        r=client.post('/api/resolve-shock',json={'account_id':20134,
            'draft':{'shock_found':True,'income_change_requested':True},
            'income_replacement_pct':value,'duration_months':6})
        assert r.status_code==422
