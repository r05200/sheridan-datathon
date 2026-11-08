"""Deterministic preparation and contingency plans; no generated financial advice."""
from dataclasses import dataclass
import math
from .timeline import assess


@dataclass
class PlanningOptions:
    target_months: int = 3
    deadline_months: int = 12
    monthly_contribution: float | None = None
    confirmed_monthly_cut: float = 0
    confirmed_extra_income: float = 0
    confirmed_upfront_funds: float = 0
    target_amount_override: float | None = None

    def validate(self):
        if self.target_amount_override is not None and (not math.isfinite(self.target_amount_override) or not 0 < self.target_amount_override <= 1_000_000):
            raise ValueError("Custom fund target must be positive and at most $1,000,000")
        if self.monthly_contribution is not None and self.monthly_contribution <= 0:
            raise ValueError("Enter a positive savings contribution, or leave it blank for the available surplus")
        for name, ceiling in [('target_months', 12), ('deadline_months', 120)]:
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= ceiling:
                raise ValueError(f'{name} must be a whole number between 1 and {ceiling}')
        for name in ['monthly_contribution', 'confirmed_monthly_cut',
                     'confirmed_extra_income', 'confirmed_upfront_funds']:
            value = getattr(self, name)
            if value is not None and (not math.isfinite(value) or not 0 <= value <= 1_000_000):
                raise ValueError(f'{name} must be finite and between 0 and 1,000,000')


def up(value):
    """Required amounts round up to cents; avoid floating point over-rounding."""
    return math.ceil(round(max(value, 0) * 100, 8)) / 100


def down(value):
    return math.floor(round(max(value, 0) * 100, 8)) / 100


def dollars(value):
    return f'${value:,.2f}'


def build_action_plan(baseline, income_after, spending_after, one_off, duration, options, monthly_budget=None):
    options.validate()
    income, spending, buffer = baseline['income'], baseline['spending'], baseline['buffer']
    surplus = income - spending
    capacity = down(surplus)
    contribution = capacity if options.monthly_contribution is None else options.monthly_contribution
    if contribution > capacity:
        raise ValueError(f'This account currently supports at most {dollars(capacity)}/month of saving. '
                         'Use a smaller contribution; the plan shows the cash-flow improvement needed for your deadline.')
    target = up(options.target_amount_override if options.target_amount_override is not None else options.target_months * spending)
    remaining = up(target - buffer)
    target_met = remaining == 0
    months = 0 if target_met else math.ceil(round(remaining / contribution, 10)) if contribution > 0 else None
    needed_saving = up(remaining / options.deadline_months)
    deadline_change = up(needed_saving - surplus) if not target_met else 0
    affordable = target_met or needed_saving <= capacity
    goal_status = ('target_met' if target_met else 'no_surplus' if capacity == 0 else
                   'no_contribution' if contribution == 0 else 'saving')
    if target_met:
        goal_steps = [f'The current buffer already meets your chosen fund target. '
                      'Preserve that buffer and reassess it when income or spending changes.']
    elif capacity == 0:
        goal_steps = [f'First close the baseline monthly shortfall of {dollars(up(-surplus))}.',
                      f'To reach the target in {options.deadline_months} months, improve monthly cash flow by '
                      f'{dollars(deadline_change)} in total, including {dollars(needed_saving)} for saving.']
    elif contribution == 0:
        goal_steps = ['Choose a positive monthly contribution within the available surplus to start this goal.']
    else:
        goal_steps = [f'Set aside {dollars(contribution)} per month from the current surplus.',
                      f'At that pace, the target is reached in {months} whole months, assuming stable cash flow.']
    if not target_met and capacity > 0 and affordable:
        goal_steps.append(f'The {options.deadline_months}-month deadline needs {dollars(needed_saving)}/month; '
                          'that amount fits within the normal monthly surplus.')
    if not target_met and capacity > 0 and not affordable:
        goal_steps.append(f'The {options.deadline_months}-month deadline requires {dollars(needed_saving)}/month; '
                          f'improve cash flow by another {dollars(deadline_change)}/month or extend the deadline.')
    milestone_months = sorted({0, 1, options.deadline_months, months or options.deadline_months})
    milestones = [{'month': n, 'projected_buffer': round(buffer + contribution * n, 2)} for n in milestone_months]
    goal = {
        'target_basis': 'custom_amount' if options.target_amount_override is not None else 'months_of_spending',
        'target_amount_override': options.target_amount_override, 'normal_monthly_spending': round(spending,2),
        'status': goal_status, 'target_months': options.target_months, 'target_amount': target,
        'current_buffer': round(buffer, 2), 'amount_still_needed': remaining,
        'progress_pct': round(min(100, max(0, buffer) / target * 100), 1) if target else (100 if target_met else 0),
        'baseline_monthly_surplus': round(surplus, 2), 'available_monthly_saving': capacity,
        'monthly_contribution': contribution, 'months_to_goal': months,
        'deadline_months': options.deadline_months, 'monthly_saving_for_deadline': needed_saving,
        'deadline_affordable_from_surplus': affordable,
        'deadline_met_at_selected_contribution': target_met or (months is not None and months <= options.deadline_months),
        'monthly_cash_flow_improvement_for_deadline': deadline_change,
        'steps': goal_steps, 'milestones': milestones,
        'assumption': 'Preparation uses normal cash flow before the shock; the buffer is the challenge balance proxy.',
    }

    if options.confirmed_monthly_cut > spending_after:
        raise ValueError('Confirmed spending reductions cannot exceed the scenario monthly spending')
    initial_buffer = buffer - one_off
    adjusted_buffer = initial_buffer + options.confirmed_upfront_funds
    adjusted_income = income_after + options.confirmed_extra_income
    adjusted_spending = spending_after - options.confirmed_monthly_cut
    monthly_net = adjusted_income - adjusted_spending
    gap = max(-monthly_net, 0)
    upfront_remaining = up(-adjusted_buffer)
    horizon_need = up(one_off + duration * gap - buffer - options.confirmed_upfront_funds) if duration else None
    additional_improvement = up(gap - max(adjusted_buffer, 0) / duration) if duration else up(gap)
    ending = adjusted_buffer + duration * monthly_net if duration else None
    covered = adjusted_buffer >= 0 and ending >= 0 if duration else None
    adjusted_timeline = None
    if monthly_budget:
        adjusted_budgets = [{'income': m['income'] + options.confirmed_extra_income,
                            'spending': m['spending'] - options.confirmed_monthly_cut} for m in monthly_budget]
        adjusted_timeline = assess(adjusted_buffer, adjusted_budgets)
        ending = adjusted_timeline['ending']
        covered = adjusted_timeline['covered']
        additional_improvement = up(adjusted_timeline['improvement'])
        horizon_need = up(adjusted_timeline['peak_gap'] - adjusted_buffer)
    status = ('immediate_funding_gap' if upfront_remaining else
              'covered' if covered else 'funding_gap' if duration else
              'stabilized' if monthly_net >= 0 else 'needs_duration')
    maximum_spending = min(spending_after, adjusted_income + max(adjusted_buffer, 0) / duration) if duration else min(spending_after, adjusted_income)
    backup_steps = []
    if upfront_remaining:
        backup_steps.append(f'Arrange {dollars(upfront_remaining)} of immediate funding before the one-off expense '
                            'can be covered. Future monthly cuts do not pay an upfront shortfall.')
    if options.confirmed_monthly_cut:
        backup_steps.append(f'Apply your confirmed spending reduction of {dollars(options.confirmed_monthly_cut)}/month.')
    if options.confirmed_extra_income:
        backup_steps.append(f'Include your confirmed additional income of {dollars(options.confirmed_extra_income)}/month.')
    if covered:
        backup_steps.append(f'The proposed budget covers {duration} months and leaves {dollars(ending)} at the end.')
    elif additional_improvement:
        backup_steps.append(f'Another {dollars(additional_improvement)}/month of lower spending or extra income '
                            f'is needed {"over the assessment window" if duration else "to stop drawing down the buffer"}. '
                            'Identify affordable changes before treating this as achievable.')
    elif upfront_remaining:
        backup_steps.append('Monthly cash flow is balanced, but the immediate funding shortfall still needs to be covered.')
    elif not duration:
        backup_steps.append('Monthly cash flow is balanced. Supply a duration to evaluate a finite shock window.')
    if duration and horizon_need and not covered:
        backup_steps.append(f'Without further monthly changes, the total additional buffer needed for this window is '
                            f'{dollars(horizon_need)}. This is an alternative funding measure, not an amount to add '
                            'to the monthly improvement above.')
    backup = {
        'status': status, 'duration_months': duration,
        'one_off_cost': round(one_off, 2), 'buffer_after_expense': round(initial_buffer, 2),
        'confirmed_upfront_funds': options.confirmed_upfront_funds,
        'confirmed_monthly_cut': options.confirmed_monthly_cut,
        'confirmed_extra_income': options.confirmed_extra_income,
        'remaining_immediate_funding_gap': upfront_remaining,
        'income_after_actions': round(adjusted_income, 2),
        'spending_after_actions': round(adjusted_spending, 2),
        'monthly_gap_after_actions': up(gap),
        'additional_monthly_improvement_needed': additional_improvement,
        'maximum_monthly_spending_for_horizon': down(maximum_spending),
        'additional_buffer_for_horizon': horizon_need,
        'ending_buffer_after_actions': round(ending, 2) if duration else None,
        'covers_duration_after_actions': covered,
        'steps': backup_steps,
        'assumption': 'Entered cuts and extra funds are user-confirmed scenario inputs, not recommendations inferred from withdrawals. '
                      'All changes are held constant over the shared horizon; no borrowing or recovery is assumed.',
    }
    if adjusted_timeline:
        backup['monthly_projection_after_actions'] = adjusted_timeline['rows']
        backup['minimum_buffer_after_actions'] = round(adjusted_timeline['minimum'],2)
        backup['maximum_monthly_spending_for_horizon'] = down(adjusted_spending - additional_improvement)
        backup['assumption'] = 'Each temporary change ends after its selected month. Confirmed backup actions apply throughout the assessment period.'
    return {'goal': goal, 'backup': backup}
