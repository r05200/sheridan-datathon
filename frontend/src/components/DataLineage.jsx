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
    { title: 'Fetch from loans', detail: 'Only running loans (status C or D) count', value: `${cash(b.loan_payment)}/mo`, label: 'Active loan payment' },
    {
      columns: [{ title: 'Savings buffer' }, { title: 'Monthly spending' }, { title: 'Monthly inflows' }],
      merge: { title: 'Buffer ÷ monthly shortfall, capped at 120', value: runway(baselineRunway(b)), label: 'Baseline runway' },
    },
    { title: 'Saved to account_metrics' },
  ];
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
          <p className="sub">Every number in “Your starting point” comes from two tables. Here is each step, in order.</p>
        </div>
        <button type="button" className="lineage-replay" onClick={() => setRevealed(1)}
          disabled={revealed <= total}>Replay ↻</button>
      </div>

      {!baseline ? <p className="empty">Loading account…</p> : (
        <ol className="lineage" aria-live="polite">
          {steps.map((s, i) => {
            if (!shown(s.beat)) return null;
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
