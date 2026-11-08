import { useEffect, useRef, useState } from 'react';
import { baselineRunway, cash, runway } from '../format.js';

const BEAT_MS = 1000;  // each step "runs" for this long before the next one is drawn beneath it

// The steps behind "Your starting point", in the order the numbers are produced.
// A step with `columns` fans out into one branch per input, then merges into `merge`.
function buildSteps(b, account) {
  const n = b.months_of_history;
  const recent = Math.min(6, n);
  return [
    { title: 'Fetch from monthly_summary', detail: `Account ${account} · ${n} monthly rows` },
    { title: 'Check every month', detail: 'One row per month, money fields must be numbers' },
    { title: 'Median of money_in', detail: 'Typical month, so one-off deposits don’t skew it', value: cash(b.income), label: 'Monthly inflows' },
    { title: 'Median of money_out', detail: 'Everything that left the account each month', value: cash(b.spending), label: 'Monthly spending' },
    { title: 'Median of household_bills', detail: 'Recorded bill category', value: cash(b.household_bills), label: 'Household bills' },
    {
      columns: [{ title: 'household_bills' }, { title: 'insurance' }, { title: 'loan_payments' }],
      merge: { title: 'Add them each month, take the median', value: cash(b.fixed_costs), label: 'Fixed costs' },
    },
    {
      columns: Array.from({ length: recent }, (_, i) => ({ title: `Month ${n - recent + i + 1}`, detail: 'avg daily balance' })),
      merge: { title: `Average of the last ${recent} months`, value: cash(b.buffer), label: 'Savings buffer' },
    },
    { title: 'Fetch from loans', detail: 'Only running loans count', value: `${cash(b.loan_payment)}/mo`, label: 'Active loan payment' },
    {
      columns: [{ title: 'Savings buffer' }, { title: 'Monthly spending' }, { title: 'Monthly inflows' }],
      merge: { title: 'Buffer ÷ monthly shortfall, capped at 120', value: runway(baselineRunway(b)), label: 'Baseline runway' },
    },
    { title: 'Saved to account_metrics' },
    ...insightSteps(b),
  ];
}

const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);

// The steps behind "A closer look at this account" (backend/app/insights.py). Skipped if insights are unavailable.
function insightSteps(b) {
  const s = b.stress;
  if (!s) return [];
  const rev = s.reverse_stress;
  const drift = s.spending_drift;
  const buf = s.buffer_status;
  const inc = s.income_trend;
  const peer = b.peer_context;
  const watch = b.watchlist;
  const pension = b.pension_check;
  const loan = s.loan_risk;
  const steps = [
    { section: 'A closer look at this account' },
    { title: 'Read the full monthly history', detail: `${s.observations} months · money in and out, month-end and lowest balance · latest ${s.last_month}` },
    {
      columns: [{ title: 'Monthly inflows' }, { title: 'Monthly spending' }, { title: 'Savings buffer' }],
      merge: {
        title: `Reverse stress test over ${rev.horizon_months} months`,
        detail: 'Largest income drop the savings can absorb',
        value: rev.maximum_income_loss_pct != null ? `${rev.maximum_income_loss_pct}%` : rev.zero_income_coverage ? '100%' : 'Not covered',
        label: 'Income could fall by',
      },
    },
  ];
  if (drift.available) {
    steps.push({
      columns: [
        { title: 'Last 3 months', detail: cash(drift.recent_three_months) },
        { title: 'Same 3 months last year', detail: cash(drift.same_months_prior_year) },
      ],
      merge: { title: 'Compare spending, flag above 1.5×', value: `${drift.ratio.toFixed(2)}×`, label: 'Spending vs last year' },
    });
  }
  if (buf.available) {
    steps.push({
      columns: [
        { title: 'Latest month-end balance', detail: cash(buf.latest_month_end_balance) },
        { title: 'Usual savings buffer', detail: cash(buf.baseline_buffer) },
      ],
      merge: { title: 'Latest ÷ usual, flag below half', value: pct(buf.latest_to_buffer_ratio), label: 'Savings vs usual' },
    });
  }
  steps.push(
    {
      columns: [
        { title: 'Median of last 3 months', detail: cash(inc.recent_3_month_median) },
        { title: 'Median of all months', detail: cash(inc.official_full_history_median) },
      ],
      merge: { title: 'Compare, flag if recent is under 80%', value: cash(inc.recent_3_month_median), label: 'Recent monthly income' },
    },
    {
      title: 'Scan every month for trouble',
      detail: `${s.negative_month_count} months below $0 · lowest balance ${cash(s.worst_observed_balance)}`,
      value: pct(s.cash_withdrawal_share),
      label: 'Spent as cash',
    },
  );
  if (peer) {
    steps.push({
      columns: [{ title: `Income quartile ${peer.income_quartile}` }, { title: peer.pension_majority ? 'Mostly pension income' : 'Not mostly pension' }],
      merge: {
        title: `Rank runway against ${peer.peer_count.toLocaleString()} similar accounts`,
        value: `${Math.round(peer.runway_percentile)}%`,
        label: 'Savings last longer than',
      },
    });
  }
  steps.push(watch.eligible
    ? {
        columns: [{ title: 'Latest balance' }, { title: '3-month surplus' }, { title: 'Balance trend' }],
        merge: {
          title: `Rank against ${watch.eligible_accounts.toLocaleString()} never-negative accounts`,
          detail: 'Equal weight to each; top 5% Priority, next 15% Watch',
          value: watch.band,
          label: 'Past-account comparison',
        },
      }
    : { title: 'Past-account comparison skipped', detail: 'This account has gone below $0 before' });
  if (pension) {
    steps.push({
      title: 'Pension check: income at 55%',
      detail: 'Employment Insurance does not apply to pension income',
      value: pension.ei55_runway_status === 'no_shortfall' ? 'No shortfall' : `${pension.ei55_runway_months} months`,
      label: 'Runway at 55%',
    });
  }
  if (loan?.available) {
    steps.push({
      title: 'Compare the loan with past loans',
      detail: `3 months of records before it began · ${loan.comparison_group_size.toLocaleString()} active loans`,
      value: loan.band.replace(' relative ranking', ''),
      label: 'Loan group',
    });
  }
  return steps;
}

// Give every step its beat number: a plain node is one beat; a split is two (branches, then the merge).
function withBeats(steps) {
  let beat = 0;
  const out = steps.map(s => (s.columns ? { ...s, beat: beat++, mergeBeat: beat++ } : { ...s, beat: beat++ }));
  return { steps: out, total: beat };
}

function Node({ status, title, detail, value, label, branch }) {
  return (
    <div className={`lin-node ${status}${branch ? ' branch' : ''}`} aria-busy={status === 'active'}>
      <span className="lin-dot" aria-hidden="true" />
      <div className="lin-text">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
      {value && <div className="lin-value"><small>{label}</small><b>{value}</b></div>}
    </div>
  );
}

// Curved paths between the centre and each of n equal-width columns (out = splitting, in = merging).
// Drawn in real pixels (measured width) so strokes are not stretched.
const FAN_H = 44;
function Fan({ n, dir }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mid = w / 2;
  const xs = Array.from({ length: n }, (_, k) => ((k + 0.5) / n) * w);
  return (
    <svg ref={ref} className="lin-fan" viewBox={`0 0 ${w || 1} ${FAN_H}`} aria-hidden="true">
      {w > 0 && xs.map(x => (
        <path key={x}
          d={dir === 'out' ? `M${mid} 0 C${mid} 24 ${x} 20 ${x} ${FAN_H}` : `M${x} 0 C${x} 24 ${mid} 20 ${mid} ${FAN_H}`} />
      ))}
    </svg>
  );
}

export default function DataLineage({ baseline, account, onBack }) {
  const [revealed, setRevealed] = useState(1);   // beats shown; the newest one is still "running"
  const tail = useRef(null);
  const { steps, total } = baseline ? withBeats(buildSteps(baseline, account)) : { steps: [], total: 0 };

  // One beat every BEAT_MS; the extra final beat marks the last step done.
  useEffect(() => {
    if (!total || revealed > total) return undefined;
    const t = setTimeout(() => setRevealed(r => r + 1), BEAT_MS);
    return () => clearTimeout(t);
  }, [revealed, total]);

  useEffect(() => { tail.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [revealed]);

  const status = beat => (beat < revealed - 1 ? 'done' : 'active');
  const shown = beat => beat < revealed;

  return (
    <main className="lineage-screen">
      <div className="lineage-head">
        <button type="button" className="lineage-back" onClick={onBack}>← Back</button>
        <div>
          <p className="eyebrow">DATA LINEAGE · ACCOUNT {account}</p>
          <h1>How did we get this data?</h1>
          <p className="sub">Every number on the Customer page comes from this account’s monthly records and loan record. Here is each step, in order.</p>
        </div>
        <button type="button" className="lineage-replay" onClick={() => setRevealed(1)}
          disabled={revealed <= total}>Replay ↻</button>
      </div>

      {!baseline ? <p className="empty">Loading account…</p> : (
        <ol className="lineage" aria-live="polite">
          {steps.map((s, i) => {
            if (!shown(s.beat)) return null;
            if (s.section) {
              return (
                <li key={i} ref={s.beat === revealed - 1 ? tail : undefined}>
                  <div className="lin-link" aria-hidden="true" />
                  <h2 className="lin-section">{s.section}</h2>
                </li>
              );
            }
            if (!s.columns) {
              return (
                <li key={i} ref={s.beat === revealed - 1 ? tail : undefined}>
                  {i > 0 && <div className="lin-link" aria-hidden="true" />}
                  <Node status={status(s.beat)} {...s} />
                </li>
              );
            }
            const merged = shown(s.mergeBeat);
            return (
              <li key={i} className="lin-split" ref={[s.beat, s.mergeBeat].includes(revealed - 1) ? tail : undefined}>
                <Fan n={s.columns.length} dir="out" />
                <div className="lin-columns" style={{ gridTemplateColumns: `repeat(${s.columns.length}, minmax(0, 1fr))` }}>
                  {s.columns.map(col => (
                    <div key={col.title} className="lin-column"><Node branch status={status(s.beat)} {...col} /></div>
                  ))}
                </div>
                {merged && <Fan n={s.columns.length} dir="in" />}
                {merged && <Node status={status(s.mergeBeat)} {...s.merge} />}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
