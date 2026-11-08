"""Monthly cash flows for temporary shocks. Month 1 starts all recurring changes."""
import math


def assess(initial, budgets):
    balance = initial
    minimum = initial
    cumulative_gap = 0
    peak_gap = 0
    improvement = 0
    rows = [{'month': 0, 'balance': round(initial, 2)}]
    for month, budget in enumerate(budgets, 1):
        income, spending = budget['income'], budget['spending']
        if spending < 0:
            raise ValueError(f'Spending reductions exceed spending in month {month}')
        cumulative_gap += spending - income
        peak_gap = max(peak_gap, cumulative_gap)
        improvement = max(improvement, (cumulative_gap - max(initial, 0)) / month)
        balance += income - spending
        minimum = min(minimum, balance)
        rows.append({'month': month, 'income': round(income, 2), 'spending': round(spending, 2),
                     'net_change': round(income-spending, 2), 'balance': round(balance, 2)})
    return {'rows': rows, 'ending': balance, 'minimum': minimum,
            'peak_gap': max(0, peak_gap), 'improvement': max(0, improvement),
            'covered': minimum >= -1e-8}


def monthly_budgets(baseline, shock, horizon):
    overrides = shock.effect_durations
    def active(key, month, fallback=None):
        return month <= overrides.get(key, fallback or horizon)
    result = []
    for month in range(1, horizon+1):
        income = baseline['income']
        if shock.income_multiplier is not None and active('income',month,shock.income_duration_months):
            income *= shock.income_multiplier
        spending = baseline['spending']
        if shock.household_bills_pct_change is not None and active('bills',month):
            spending += baseline['household_bills']*shock.household_bills_pct_change/100
        if shock.spending_pct_change is not None and active('spending',month):
            spending += baseline['spending']*shock.spending_pct_change/100
        for i,cost in enumerate(shock.recurring_costs):
            if active(f'category_{i}',month,cost.duration_months):
                spending += cost.monthly_change
        result.append({'income':income,'spending':spending})
    return result
