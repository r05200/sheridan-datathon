from app.shock_parser import ParsedShockSchema,resolve_draft


def test_missing_category_budgets_do_not_become_rephrase_blockers():
    draft=ParsedShockSchema(shock_found=True,category_changes=[
        {'category':'groceries','pct_change':10}, {'category':'rent','pct_change':15}],
        one_off_costs=[{'label':'lost cash','amount_dollars':5000}],
        unresolved=[{'field':'groceries','reason':'What is the current monthly cost of groceries?'},
                    {'field':'category_changes[1].current_monthly_cost','reason':'What is the current monthly cost of rent?'},
                    {'field':'duration','reason':'For how many months?'}])
    initial=resolve_draft(draft)
    assert not any(q['kind']=='rephrase' for q in initial['questions'])
    ready=resolve_draft(draft,category_amounts={'0':500,'1':1000},effect_durations={'category_0':2,'category_1':6})
    assert ready['status']=='ok',ready
    assert ready['shock']['scenario_duration_months']==6
    assert ready['shock']['one_off_costs'][0]['amount_dollars']==5000
    assert [c['monthly_change'] for c in ready['shock']['recurring_costs']]==[50,150]


def test_unrelated_unresolved_cost_still_requires_clarification():
    draft=ParsedShockSchema(shock_found=True,category_changes=[{'category':'rent','monthly_delta':50}],
        unresolved=[{'field':'one_off_costs','reason':'What does the repair cost?'}])
    result=resolve_draft(draft,effect_durations={'category_0':3})
    assert any(q['kind']=='rephrase' for q in result['questions'])
