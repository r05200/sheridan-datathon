from fastapi.testclient import TestClient
from app import db, insights
from app.main import app


def test_separate_pages():
    client=TestClient(app)
    first=client.get('/api/tangerine/accounts').json()
    second=client.get('/api/tangerine/accounts?page=2').json()
    assert len(first['accounts'])==len(second['accounts'])==30
    assert first['has_next'] and not first['has_previous'] and second['has_previous']
    assert not ({r['account_id'] for r in first['accounts']} & {r['account_id'] for r in second['accounts']})
    assert 'loan_status' in first['accounts'][0]
    assert 'runway_status' in first['accounts'][0]


def test_filter_search_and_validation():
    client=TestClient(app)
    allowed={r['account_id'] for r in insights.account_directory('negative')['accounts']}
    result=client.get('/api/tangerine/accounts?filter=negative&page=2').json()
    assert len(result['accounts'])==30
    assert all(r['account_id'] in allowed for r in result['accounts'])
    result=client.get('/api/tangerine/accounts?search=20134').json()
    assert result['total']==1 and result['accounts'][0]['account_id']==20134
    empty=client.get('/api/tangerine/accounts?search=not-an-id').json()
    assert empty['accounts']==[] and not empty['has_next']
    assert client.get('/api/tangerine/accounts?filter=invalid').status_code==422
    assert client.get('/api/tangerine/accounts?page=0').status_code==422


def test_current_baseline_portfolio(monkeypatch):
    monkeypatch.setattr(db,'get_all_baselines',lambda:{1:{'income':100,'spending':200,'buffer':300,'household_bills':50}})
    result=TestClient(app).get('/api/tangerine/portfolio').json()
    assert result['total_accounts']==1
    assert result['baseline']['under_six_months']==1
    assert result['baseline']['spending_exceeds_income']==1
