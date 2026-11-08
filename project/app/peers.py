"""Anonymous, deterministic cohort comparisons; a spending benchmark is not a budget."""
import math
from statistics import median

MIN_PEERS = 10
MAX_PEERS = 50
COMPARISONS = [
    ('spending','Total monthly outflow','Review the biggest recurring payments first. This total overlaps the channels below; do not add the gaps together.'),
    ('household_bills','Household bills','Compare providers and recurring charges. Housing and utilities may be essential; only test changes you can actually make.'),
    ('cash_withdrawals','Cash withdrawals','Check what the cash pays for. Identify optional purchases before choosing any reduction.'),
    ('card_withdrawals','Card withdrawals','Review the underlying purchases before deciding whether any amount can be reduced.'),
    ('transfers_out_other','Other outgoing transfers','Check the recipients and purpose. Transfers may cover bills, family support or movement between your own accounts.'),
]


def compare_peers(account_id, records):
    target=records.get(account_id)
    if target is None:
        from .db import AccountNotFound
        raise AccountNotFound(account_id)
    required=['income','fixed_costs','loan_payment','spending']
    def valid(row):
        return all(math.isfinite(row.get(k,float('nan'))) and row[k]>=0 for k in required)
    method={'income_tolerance_pct':30,'fixed_cost_tolerance_pct':40,'loan_payment_tolerance_pct':40,
            'cost_tolerance_floor':200,'minimum_peers':MIN_PEERS,'maximum_peers':MAX_PEERS,
            'description':'Closest accounts within 30% of income and 40% of fixed costs and loan payments (a $200 tolerance floor for costs), with the same active-loan-payment status. The selected account is excluded.'}
    if not valid(target):
        return {'status':'unavailable','peer_count':0,'method':method,'comparisons':[],
                'message':'This account does not have enough valid matching data for a comparison.'}
    candidates=[]
    for other_id,row in records.items():
        if other_id==account_id or not valid(row):continue
        if (row['loan_payment']>0)!=(target['loan_payment']>0):continue
        scales=[max(target['income']*.30,1),max(target['fixed_costs']*.40,200),max(target['loan_payment']*.40,200)]
        distances=[abs(row[k]-target[k])/scale for k,scale in zip(['income','fixed_costs','loan_payment'],scales)]
        if all(d<=1 for d in distances):candidates.append((sum(d*d for d in distances),other_id,row))
    candidates.sort(key=lambda x:(x[0],x[1]))
    cohort=[row for _,_,row in candidates[:MAX_PEERS]]
    common={'peer_count':len(cohort),'eligible_count':len(candidates),'method':method,
            'limitations':'These are account-level recorded spending medians, not verified household budgets. Withdrawals and transfers may pay for essentials; category and total gaps overlap.'}
    if len(cohort)<MIN_PEERS:
        return {**common,'status':'insufficient_peers','comparisons':[],
                'message':f'Only {len(cohort)} close matches were found. At least {MIN_PEERS} are needed; no spending suggestions are inferred.'}
    comparisons=[]
    for key,label,review in COMPARISONS:
        values=[row[key] for row in cohort if key in row and math.isfinite(row[key]) and row[key]>=0]
        if len(values)<MIN_PEERS or key not in target or not math.isfinite(target[key]) or target[key]<0:continue
        typical=median(values);actual=target[key];difference=actual-typical
        comparisons.append({'key':key,'label':label,'your_amount':round(actual,2),'peer_median':round(typical,2),
            'sample_size':len(values),'above_median':difference>.005,'difference':round(difference,2),
            'pct_above_median':round(difference/typical*100,1) if typical>0 and difference>0 else None,
            'review':review,'can_sum_with_other_gaps':False})
    return {**common,'status':'ok','comparisons':comparisons,
            'message':'Start with areas above the peer median. Review the underlying payments and choose an affordable reduction; matching the median is optional.'}
