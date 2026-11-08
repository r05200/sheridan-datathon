import pytest
from app import config, shock_parser as sp
from app.gemini_client import GeminiClient, GeminiError
from conftest import FakeClient


def test_default_model_and_configurable_timeout(monkeypatch):
    monkeypatch.delenv('GEMINI_MODEL', raising=False)
    assert config.gemini_model() == 'gemini-3.5-flash-lite'
    monkeypatch.setenv('GEMINI_TIMEOUT_S', '30')
    assert config._timeout_seconds() == 30
    for bad in ['0','121','nan']:
        monkeypatch.setenv('GEMINI_TIMEOUT_S',bad)
        with pytest.raises(ValueError):
            config._timeout_seconds()


def test_provider_schema_requires_extraction_containers():
    required=sp.GeminiShockSchema.model_json_schema()['required']
    for field in ['one_off_costs','category_changes','assumptions','unresolved','interpretation']:
        assert field in required


def test_empty_extraction_is_not_a_success():
    r=sp.parse_shock('bought a car for 20000$', client=FakeClient({'shock_found':True}))
    assert r['status']=='error' and r['shock'] is None
    assert 'did not extract' in r['message']


def test_car_purchase_keeps_exact_amount_and_upfront_assumption():
    r=sp.parse_shock('bought a car for 20000$', client=FakeClient({
        'shock_found':True,
        'one_off_costs':[{'label':'Car purchase','amount_dollars':20000}],
        'assumptions':['Assumes paid upfront from savings; confirm if financed.'],
        'interpretation':'A car purchase paid upfront from savings.'}))
    assert r['status']=='ok' and r['shock']['one_off_costs'][0]['amount_dollars']==20000
    assert 'upfront' in r['assumptions'][0]


def test_unavailable_model_is_actionable_and_not_retried(monkeypatch):
    monkeypatch.setattr(config,'gemini_disabled',lambda:False)
    calls=[]
    class ModelMissing(Exception):
        code=404
    def fail(*args):
        calls.append(1)
        raise ModelMissing('private provider details')
    c=GeminiClient()
    monkeypatch.setattr(c,'_call',fail)
    r=sp.parse_shock('bought a car for 20000$',client=c)
    assert len(calls)==1
    assert r['status']=='error' and 'GEMINI_MODEL' in r['message']
    assert 'private provider details' not in str(r)


def test_timeout_is_actionable():
    r=sp.parse_shock('bought a car for 20000$',client=FakeClient(GeminiError('timeout',kind='timeout')))
    assert r['status']=='error' and 'too long' in r['message']


def test_transport_rejects_missing_required_fields(monkeypatch):
    monkeypatch.setattr(config, 'gemini_disabled', lambda: False)
    c=GeminiClient(retries=0)
    monkeypatch.setattr(c, '_call', lambda *args: '{"shock_found":true}')
    with pytest.raises(GeminiError):
        c.generate_json('system','user',sp.GeminiShockSchema)


def test_direct_http_uses_json_and_low_thinking_without_nested_schema(monkeypatch):
    import httpx
    monkeypatch.setenv('GEMINI_MODEL','gemini-3.8-flash')
    captured={}
    class Response:
        status_code=200
        def json(self):
            return {'candidates':[{'content':{'parts':[{'text':'{}'}]}}]}
    def post(*args,**kw):
        captured.update(kw)
        return Response()
    monkeypatch.setattr(httpx,'post',post)
    c=GeminiClient()
    assert c._call('system','user',sp.GeminiShockSchema)=='{}'
    generation=captured['json']['generationConfig']
    assert generation['thinkingConfig']['thinkingLevel']=='low'
    assert generation['responseMimeType']=='application/json'
    assert 'responseSchema' not in generation
    assert captured['json']['systemInstruction']['parts'][0]['text']=='system'
    assert captured['json']['contents'][0]['parts'][0]['text']=='user'
    monkeypatch.setenv('GEMINI_MODEL','gemini-3.5-flash-lite')
    c._call('system','user',sp.GeminiShockSchema)
    assert captured['json']['generationConfig']['thinkingConfig']['thinkingLevel']=='minimal'


def test_direct_http_provider_error_stays_actionable(monkeypatch):
    import httpx
    class Response:
        status_code=429
    monkeypatch.setattr(httpx,'post',lambda *args,**kw:Response())
    with pytest.raises(GeminiError) as err:
        GeminiClient()._call('system','user',sp.GeminiShockSchema)
    assert err.value.kind=='quota'
