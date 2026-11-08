import psycopg2
import pytest
from app import config, db


def test_all_live_reads_use_current_metrics_table(monkeypatch):
    monkeypatch.setattr(config, 'db_disabled', lambda: False)
    calls=[]
    row={'account_id':20134, **{k:1 for k in db.EXPORT_COLUMNS if k!='account_id'}}
    def query(sql, params=None):
        calls.append((sql, params))
        if 'COUNT(*) AS total' in sql:return [{'total':4500}]
        if 'COUNT(*) AS n' in sql:return [{'n':4500}]
        return [row]
    monkeypatch.setattr(db,'_query',query)
    db.get_account_baseline(20134)
    db.get_loan_payment(20134)
    db.get_flexible_spending(20134)
    db.get_all_baselines()
    db.get_account_page(2,'201')
    assert db.table_counts()=={'account_metrics':4500}
    assert all('public.account_metrics' in sql for sql,_ in calls)
    page_query=next((sql,params) for sql,params in calls if 'LIMIT %s OFFSET %s' in sql)
    assert page_query[1]==('%201%',30,30)


@pytest.mark.parametrize('error',[psycopg2.errors.UndefinedTable,psycopg2.errors.UndefinedColumn])
def test_schema_mismatch_has_actionable_error(monkeypatch,error):
    monkeypatch.setattr(config,'db_disabled',lambda:False)
    def missing(*args):raise error('missing relation or column')
    monkeypatch.setattr(db,'_query',missing)
    with pytest.raises(db.DatabaseUnavailable,match='public.account_metrics'):
        db.get_account_baseline(20134)
