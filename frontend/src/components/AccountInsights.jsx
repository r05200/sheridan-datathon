import { cash } from '../format.js';

const pct = value => value == null ? 'Not recorded' : `${(value * 100).toFixed(0)}%`;
const loanStatus = status => ({
  A: 'Loan paid off',
  B: 'Loan paid off with an unpaid balance recorded',
  C: 'Active loan. No debt recorded so far.',
  D: 'Active loan. Debt recorded in the past.',
}[status] || 'No loan record');
function Signal({ label, value, detail, tone = '' }) {
  return (
    <article className={`account-signal${tone ? ` ${tone}` : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
    </article>
  );
}

function MonthlyHistory({ rows }) {
  if (!rows?.length) return null;
  const max = Math.max(1, ...rows.flatMap(row => [row.money_in, row.money_out]));
  return (
    <section className="history-chart" aria-labelledby="history-chart-title">
      <div className="insight-subheading">
        <h3 id="history-chart-title">Money coming in and going out</h3>
        <span>Most recent {rows.length} months on record</span>
      </div>
      <div className="history-legend"><span>Money in</span><span>Money out</span></div>
      <div className="history-bars">
        {rows.map(row => (
          <div className="history-month" key={row.month} title={`${row.month}: money in ${cash(row.money_in)}, money out ${cash(row.money_out)}`}>
            <div className="history-bar-pair">
              <span className="history-in" style={{ height: `${Math.max(3, row.money_in / max * 100)}%` }} />
              <span className="history-out" style={{ height: `${Math.max(3, row.money_out / max * 100)}%` }} />
            </div>
            <small>{row.month.slice(5)}</small>
          </div>
        ))}
      </div>
      <div className="history-caption"><span>{rows[0].month}</span><span>{rows.at(-1).month}</span></div>
    </section>
  );
}

export default function AccountInsights({ baseline }) {
  const stress = baseline?.stress;
  if (!stress) return null;

  const reverse = stress.reverse_stress;
  const drift = stress.spending_drift;
  const buffer = stress.buffer_status;
  const income = stress.income_trend;
  const balance = stress.balance_trend;
  const peer = baseline.peer_context;
  const watch = baseline.watchlist;
  const pension = baseline.pension_check;
  const loanRisk = stress.loan_risk;
  const maxHistoricalSpending = Math.max(drift.recent_three_months || 0, drift.same_months_prior_year || 0, 1);
  const latestRatio = buffer.latest_to_buffer_ratio;
  const reverseLabel = reverse.maximum_income_loss_pct != null
    ? `Income could fall by up to ${reverse.maximum_income_loss_pct}%`
    : reverse.zero_income_coverage
      ? 'Savings could cover 6 months with no income'
      : 'Savings may not cover 6 months of a shortfall';

  return (
    <section className="account-insights" aria-labelledby="account-insights-title">
      <div className="insight-heading">
        <div>
          <p className="eyebrow">PAST ACCOUNT ACTIVITY</p>
          <h2 id="account-insights-title">A closer look at this account</h2>
        </div>
        <span>{stress.observations.toLocaleString()} months on record. Latest: {stress.last_month}</span>
      </div>

      <div className="account-signal-grid">
        <Signal label="How much could income fall for 6 months?" value={reverseLabel}
          detail={`More savings needed for 6 months with income cut in half: ${cash(reverse.additional_buffer_for_target)}`}
          tone={!reverse.baseline_coverage && !reverse.zero_income_coverage ? 'warning' : ''} />
        <Signal label="Spent in the last 3 months" value={drift.available ? cash(drift.recent_three_months) : 'Not enough history'}
          detail={drift.available
            ? `Same 3 months last year: ${cash(drift.same_months_prior_year)}${drift.flag ? '. Spending is much higher.' : '.'}`
            : 'No complete prior-year comparison'}
          tone={drift.flag ? 'warning' : ''} />
        <Signal label="Current savings compared with usual" value={buffer.available ? pct(latestRatio) : 'Not available'}
          detail={buffer.available
            ? `${cash(buffer.latest_month_end_balance)} at the latest month-end. Usual average: ${cash(buffer.baseline_buffer)}.`
            : 'The usual average savings balance is zero or below.'}
          tone={buffer.below_half ? 'warning' : ''} />
        <Signal label="Money received each month, recently" value={cash(income.recent_3_month_median)}
          detail={`Usual monthly amount across all records: ${cash(income.official_full_history_median)}.${income.median_overstates_recent ? ' Recent income is much lower.' : ''}`}
          tone={income.median_overstates_recent ? 'warning' : ''} />
      </div>

      <div className="insight-detail-grid">
        <article className="insight-detail">
          <h3>What the past records show</h3>
          <dl className="insight-facts">
            <div><dt>Months when the account went below $0</dt><dd>{stress.negative_month_count}</dd></div>
            <div><dt>Lowest recorded account balance</dt><dd>{cash(stress.worst_observed_balance)}</dd></div>
            <div><dt>Average balance change in the last 3 months</dt><dd>{balance.recent_vs_prior_3_month_mean_change == null
              ? 'Not enough history'
              : balance.recent_vs_prior_3_month_mean_change < 0
                ? `Down ${cash(Math.abs(balance.recent_vs_prior_3_month_mean_change))}`
                : balance.recent_vs_prior_3_month_mean_change > 0
                  ? `Up ${cash(balance.recent_vs_prior_3_month_mean_change)}`
                  : 'About the same'}</dd></div>
            <div><dt>Money taken out as cash</dt><dd>{stress.cash_withdrawal_share == null
              ? 'No cash withdrawal data recorded'
              : `${pct(stress.cash_withdrawal_share)} of recorded spending`}</dd></div>
            <div><dt>Loan on record</dt><dd>{loanStatus(stress.loan_status)}</dd></div>
            <div><dt>Scheduled monthly loan payment</dt><dd>{cash(stress.loan_contract_monthly_payment)}</dd></div>
            <div><dt>Typical monthly payment in the records</dt><dd>{cash(stress.median_observed_loan_payment)}</dd></div>
          </dl>
          <small className="insight-explainer">Cash withdrawals may be needed for everyday spending, so they are not treated as optional. The recorded loan payment can be $0 when payments are intermittent.</small>
        </article>

        <article className="insight-detail">
          <h3>Compared with similar accounts</h3>
          {peer && <>
            <p className="peer-percentile">{Math.round(peer.runway_percentile)}%<small> of similar accounts</small></p>
            <p>Savings last longer than for about {Math.round(peer.runway_percentile)}% of {peer.peer_count.toLocaleString()} accounts with similar income and pension patterns.</p>
            <small>A higher percentage means savings last longer than for more similar accounts.</small>
          </>}
          <div className="watchlist-status">
            <strong>{watch.eligible ? `Past-account comparison: ${watch.band}` : 'Not included in the past-account comparison'}</strong>
            <span>Compared with {watch.eligible_accounts.toLocaleString()} accounts that never went below $0. Groups use past balances and cash flow. They do not predict the future.</span>
          </div>
          {pension && <p className="insight-callout">
            Most income is pension. {pension.ei55_runway_status === 'no_shortfall'
              ? 'Money coming in still covers spending when reduced to 55% of its usual level.'
              : `Savings last ${pension.ei55_runway_months} months when income is reduced to 55% of its usual level.`}
            Employment Insurance does not apply to pension income.
          </p>}
        </article>
      </div>

      {loanRisk?.available && (
        <article className="loan-indicator-card" aria-labelledby="loan-indicator-title">
          <div className="loan-indicator-heading">
            <div>
              <p className="eyebrow">EARLY RESEARCH ONLY</p>
              <h3 id="loan-indicator-title">How this loan compares with past loans</h3>
            </div>
            <strong>{loanRisk.band.replace(' relative ranking', '')} group</strong>
          </div>
          <p>
            Before this loan began, the account history was compared with {loanRisk.comparison_group_size.toLocaleString()} other active loans.
            This grouping does not predict whether someone will repay and is not advice about this loan.
          </p>
          <small>The comparison uses three full months of records before each loan began. It includes {loanRisk.completed_training_loans.toLocaleString()} completed loans, of which {loanRisk.completed_defaults.toLocaleString()} were recorded as unpaid. This research has not been tested for making decisions.</small>
        </article>
      )}

      {drift.available && (
        <section className="drift-comparison" aria-label="Recent spending comparison">
          <div><span>Same 3 months last year</span><i><b style={{ width: `${drift.same_months_prior_year / maxHistoricalSpending * 100}%` }} /></i><strong>{cash(drift.same_months_prior_year)}</strong></div>
          <div><span>Last 3 months</span><i><b className="recent" style={{ width: `${drift.recent_three_months / maxHistoricalSpending * 100}%` }} /></i><strong>{cash(drift.recent_three_months)}</strong></div>
        </section>
      )}

      <MonthlyHistory rows={stress.monthly_history} />
    </section>
  );
}
