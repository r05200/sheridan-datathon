import pytest
from app.peers import compare_peers
from app.engine import build_plan,Shock
from app.planning import PlanningOptions


def metric(income=3000,spending=2000,fixed=900,loan=200,cash=500):
    return {'income':income,'spending':spending,'fixed_costs':fixed,'loan_payment':loan,
            'household_bills':700,'cash_withdrawals':cash,'card_withdrawals':0,'transfers_out_other':100}


def test_cohort_excludes_self_dissimilar_income_and_loan_status():
    rows={1:metric(spending=2600,cash=900),**{i:metric() for i in range(2,22)},
          100:metric(income=9000),101:metric(loan=0),102:metric(fixed=3000)}
    p=compare_peers(1,rows)
    assert p['status']=='ok' and p['peer_count']==20
    out=next(c for c in p['comparisons'] if c['key']=='spending')
    assert out['your_amount']==2600 and out['peer_median']==2000 and out['difference']==600
    assert out['pct_above_median']==30 and not out['can_sum_with_other_gaps']
    assert 'account_id' not in str(p) and '100' not in p # aggregate only
    cash=next(c for c in p['comparisons'] if c['key']=='cash_withdrawals')
    assert 'optional' in cash['review']


def test_insufficient_peer_group_does_not_generate_benchmarks():
    p=compare_peers(1,{i:metric() for i in range(1,8)})
    assert p['status']=='insufficient_peers' and p['comparisons']==[]


def test_closest_fifty_cap_and_zero_median():
    rows={i:metric(cash=0) for i in range(1,80)};rows[1]=metric(cash=100)
    p=compare_peers(1,rows)
    assert p['peer_count']==50 and p['eligible_count']==78
    cash=next(c for c in p['comparisons'] if c['key']=='cash_withdrawals')
    assert cash['difference']==100 and cash['pct_above_median'] is None


def test_custom_goal_overrides_months_and_updates_calculations():
    base={'income':3000,'spending':2600,'buffer':5200,'household_bills':900}
    p=build_plan(base,{},Shock(),planning=PlanningOptions(target_amount_override=10000,deadline_months=24))
    goal=p['action_plan']['goal']
    assert goal['target_basis']=='custom_amount'
    assert goal['target_amount']==10000 and goal['amount_still_needed']==4800
    assert goal['months_to_goal']==12 and goal['monthly_saving_for_deadline']==200
    assert p['goal_plan']['target_amount']==10000


@pytest.mark.parametrize('target',[0,-1,float('nan'),float('inf'),1000001])
def test_invalid_custom_goal_is_rejected(target):
    with pytest.raises(ValueError):PlanningOptions(target_amount_override=target).validate()
