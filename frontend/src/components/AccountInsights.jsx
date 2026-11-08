import { cash, compactCash } from '../format.js';

const pct = value => value == null ? 'Not recorded' : `${(value * 100).toFixed(0)}%`;
const clamp = value => Math.max(0, Math.min(100, value));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const loanStatus = status => ({
  A: 'Loan paid off',
  B: 'Loan paid off with an unpaid balance recorded',
  C: 'Active loan. No debt recorded so far.',
  D: 'Active loan. Debt recorded in the past.',
}[status] || 'No loan record');

function Signal({ label, value, detail, tone = '', children }) {
  return (
    <article className={`account-signal${tone ? ` ${tone}` : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
      {children}
    </article>
  );
}

// A thin bar with optional target marks (percent positions), shown under a signal's text.
function Meter({ fill, marks = [], scale, label }) {
  return (
    <div className="signal-meter" role="img" aria-label={label}>
      <div className="meter-track">
        <span className="meter-fill" style={{ width: `${clamp(fill)}%` }} />
        {marks.map(m => <i key={m} className="meter-mark" style={{ left: `${m}%` }} aria-hidden="true" />)}
      </div>
      {scale && <div className="meter-scale">{scale.map(s => <span key={s}>{s}</span>)}</div>}
    </div>
  );
}

// A share of something, drawn as a small bar under a fact.
function FactMeter({ value, label, warning }) {
  return (
    <i className={`fact-meter${warning ? ' warning' : ''}`} role="img" aria-label={label}>
      <span style={{ width: `${clamp(value)}%` }} />
    </i>
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

// Month-end balance as a line, with the $0 line dashed. A month-end value is a snapshot.
function BalanceHistory({ rows }) {
  if (!rows?.length) return null;
  const width = 720, height = 220, left = 56, right = 12, top = 18, bottom = 38;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const balances = rows.map(row => row.month_end_balance);
  const min = Math.min(0, ...balances);
  const max = Math.max(0, ...balances);
  const pad = Math.max((max - min) * 0.08, 1);
  const lo = min - pad;
  const hi = max + pad;
  const y = v => top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const step = plotW / rows.length;
  const x = i => left + step * (i + 0.5);
  return (
    <section className="history-chart" aria-labelledby="balance-chart-title">
      <div className="insight-subheading">
        <h3 id="balance-chart-title">Month-end balance</h3>
        <span>Recorded balance over time</span>
      </div>
      <div className="history-legend balance-legend"><span>Balance</span><span>$0 line</span></div>
      <svg className="balance-chart" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Month-end balance for the last ${rows.length} recorded months; the dashed line marks zero`}>
        <line className="chart-gridline" x1={left} y1={top} x2={width - right} y2={top} />
        <line className="chart-zero" x1={left} y1={y(0)} x2={width - right} y2={y(0)} />
        <text className="chart-label" x={left - 8} y={top + 4} textAnchor="end">{compactCash(max)}</text>
        <text className="chart-label" x={left - 8} y={top + plotH} textAnchor="end">{compactCash(min)}</text>
        <polyline className="balance-line" points={rows.map((row, i) => `${x(i)},${y(row.month_end_balance)}`).join(' ')} />
        {rows.map((row, i) => (
          <circle key={row.month} className="balance-point" cx={x(i)} cy={y(row.month_end_balance)} r="3.5">
            <title>{`${row.month} month-end balance: ${cash(row.month_end_balance)}`}</title>
          </circle>
        ))}
        {rows.map((row, i) => i % 2 === 0 && (
          <text key={row.month} className="chart-label" x={x(i)} y={height - 12} textAnchor="middle">
            {MONTHS[Number(row.month.slice(5, 7)) - 1] || row.month}
          </text>
        ))}
      </svg>
      <small className="history-note">A month-end value is a snapshot; it does not show every balance change during the month.</small>
    </section>
  );
}

// Where this loan sits among ongoing loans: three bands, one marker. Not a probability of default.
function LoanRiskScale({ band, size }) {
  const key = band.toLowerCase();
  if (!['lower', 'middle', 'higher'].includes(key)) return null;
  return (
    <div className={`loan-risk-scale risk-${key}`} role="img"
      aria-label={`${band} group among ${size.toLocaleString()} ongoing loans; this is not a probability of default`}>
      <div className="loan-risk-track"><span className="loan-risk-marker" /></div>
      <div className="loan-risk-labels"><span>Lower</span><span>Middle</span><span>Higher</span></div>
    </div>
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
  // The meter's fill: the survivable income loss, or full when even zero income is covered.
  const maxLoss = reverse.maximum_income_loss_pct ?? (reverse.zero_income_coverage ? 100 : null);
  const negativeRate = stress.observations ? 100 * stress.negative_month_count / stress.observations : 0;
  const loanBand = loanRisk?.available ? loanRisk.band.replace(' relative ranking', '') : '';

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
          tone={!reverse.baseline_coverage && !reverse.zero_income_coverage ? 'warning' : ''}>
          {maxLoss != null
            ? <Meter fill={maxLoss} marks={[50]} scale={['0% income loss', '50% target', '100%']}
                label={`Income could fall by ${maxLoss}% before six months of savings run out; the mark is the 50% target`} />
            : <span className="meter-status">No positive stress margin</span>}
        </Signal>
        <Signal label="Spent in the last 3 months" value={drift.available ? cash(drift.recent_three_months) : 'Not enough history'}
          detail={drift.available
            ? `Same 3 months last year: ${cash(drift.same_months_prior_year)}${drift.flag ? '. Spending is much higher.' : '.'}`
            : 'No complete prior-year comparison'}
          tone={drift.flag ? 'warning' : ''} />
        <Signal label="Current savings compared with usual" value={buffer.available ? pct(latestRatio) : 'Not available'}
          detail={buffer.available
            ? `${cash(buffer.latest_month_end_balance)} at the latest month-end. Usual average: ${cash(buffer.baseline_buffer)}.`
            : 'The usual average savings balance is zero or below.'}
          tone={buffer.below_half ? 'warning' : ''}>
          {buffer.available && (
            <Meter fill={latestRatio * 100} marks={[25, 50]} scale={['0', '50% review mark', '100%']}
              label={`Latest balance is ${pct(latestRatio)} of the usual buffer; marks at 25% and 50%`} />
          )}
        </Signal>
        <Signal label="Money received each month, recently" value={cash(income.recent_3_month_median)}
          detail={`Usual monthly amount across all records: ${cash(income.official_full_history_median)}.${income.median_overstates_recent ? ' Recent income is much lower.' : ''}`}
          tone={income.median_overstates_recent ? 'warning' : ''} />
      </div>

      <div className="insight-detail-grid">
        <article className="insight-detail">
          <h3>What the past records show</h3>
          <dl className="insight-facts">
            <div><dt>Months when the account went below $0</dt><dd>{stress.negative_month_count}
              <FactMeter value={negativeRate} warning={stress.negative_month_count > 0}
                label={`${negativeRate.toFixed(1)}% of recorded months went below $0`} /></dd></div>
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
              : <>{pct(stress.cash_withdrawal_share)} of recorded spending
                <FactMeter value={stress.cash_withdrawal_share * 100} label={`${pct(stress.cash_withdrawal_share)} of recorded money out was cash withdrawals`} /></>}</dd></div>
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
            <div className="peer-track" role="img" aria-label={`Savings last longer than for ${Math.round(peer.runway_percentile)}% of similar accounts`}>
              <span style={{ width: `${clamp(peer.runway_percentile)}%` }} />
            </div>
            <div className="meter-scale"><span>Shorter runway</span><span>Longer runway</span></div>
            <small>A higher percentage means savings last longer than for more similar accounts.{peer.peer_capped_share != null && ` ${peer.peer_capped_share}% of this group is shown at the 120-month cap.`}</small>
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
            <strong>{loanBand} group</strong>
          </div>
          <LoanRiskScale band={loanBand} size={loanRisk.comparison_group_size} />
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

      <div className="history-visuals">
        <MonthlyHistory rows={stress.monthly_history} />
        <BalanceHistory rows={stress.monthly_history} />
      </div>
    </section>
  );
}
