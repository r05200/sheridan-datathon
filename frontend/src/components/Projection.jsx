import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cash, compactCash, preciseCash } from '../format.js';

// Plot area inside the 600 x 296 viewBox.
const LEFT = 76, RIGHT = 568, TOP = 34, BOTTOM = 242;

// Month-by-month buffer: the engine's path for stacked scenarios with different durations,
// otherwise a straight line from the buffer after immediate costs to the assessed end balance.
function buildSeries(plan) {
  const d = plan.duration_assessment;
  const a = plan.after_shock;
  if (d.buffer_path) return d.buffer_path.map((value, month) => ({ month, value }));
  const net = (d.ending_buffer - a.buffer) / d.months;
  return Array.from({ length: d.months + 1 }, (_, i) => ({ month: i, value: a.buffer + i * net }));
}

const crossing = (prev, next) => prev.month + prev.value / (prev.value - next.value);

// Add a point wherever the line crosses $0, so the funded and unfunded parts can be drawn apart,
// and find the month the savings first run out.
function splitAtZero(values) {
  const points = [values[0]];
  let exhausted = values[0].value <= 0 ? 0 : null;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const next = values[i];
    if (prev.value * next.value < 0) points.push({ month: crossing(prev, next), value: 0 });
    if (exhausted === null && next.value <= 0) exhausted = crossing(prev, next);
    points.push(next);
  }
  return { points, exhausted };
}

// Consecutive runs of points on one side of $0; a point on the line belongs to both sides.
function runs(points, sign) {
  const out = [];
  let current = [];
  for (const p of points) {
    if (sign * p.value >= 0) current.push(p);
    else { if (current.length) out.push(current); current = []; }
  }
  if (current.length) out.push(current);
  return out;
}

const Row = ({ label, children }) => <div><dt>{label}</dt><dd>{children}</dd></div>;

// How the buffer moves through the scenario: area chart with the unfunded part dashed in red,
// a marker where savings run out, and a tooltip per month. Replaces the earlier plain line chart.
export default function Projection({ plan }) {
  const gradientId = 'buffer-fill-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const d = plan.duration_assessment;
  const a = plan.after_shock;
  const n = d.months;
  const values = buildSeries(plan);
  const end = values[n].value;
  const top = Math.max(1, ...values.map(v => v.value));
  const bottom = Math.min(0, ...values.map(v => v.value));
  const pad = (top - bottom) * 0.14;
  const hi = top + pad;
  const lo = bottom < 0 ? bottom - pad : 0;
  const x = m => LEFT + (m / n) * (RIGHT - LEFT);
  const y = v => TOP + ((hi - v) / (hi - lo)) * (BOTTOM - TOP);

  const { points, exhausted } = splitAtZero(values);
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const area = pts => (pts.length > 1 ? `${path(pts)} L${x(pts.at(-1).month)},${y(0)} L${x(pts[0].month)},${y(0)} Z` : '');
  const positive = runs(points, 1);
  const negative = runs(points, -1);
  const ticks = n <= 12
    ? Array.from({ length: n + 1 }, (_, i) => i)
    : [...new Set([0, ...Array.from({ length: 6 }, (_, i) => Math.round((n * (i + 1)) / 6))])];
  // Grid lines, skipping the one that would sit on top of the $0 line.
  const grid = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4).filter(v => Math.abs(v) > (hi - lo) * 0.03);
  const shortfall = exhausted !== null;
  const status = shortfall
    ? `Savings run out ${exhausted === 0 ? 'immediately' : 'around month ' + exhausted.toFixed(1)}`
    : `Buffer lasts through month ${n}`;

  // Tooltip: one visible box positioned over the hovered/focused point (the SVG <title> popup is browser-dependent).
  const [tip, setTip] = useState(null);
  const tipRef = useRef(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const t = el.getBoundingClientRect();
    const r = tip.rect;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
    el.style.top = `${Math.max(8, r.top - t.height - 10)}px`;
  }, [tip]);
  useEffect(() => {
    if (!tip) return undefined;
    const hide = () => setTip(null);
    const onKey = e => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', hide, true); document.removeEventListener('keydown', onKey); };
  }, [tip]);
  const show = (e, label) => setTip({ label, rect: e.currentTarget.getBoundingClientRect() });
  const hide = () => setTip(null);

  // "How this balance is calculated": the plan's own figures, before any confirmed backup actions.
  const ap = plan.action_plan;
  const startBuffer = ap?.goal.current_buffer ?? plan.baseline.buffer;
  const oneOff = ap?.backup.one_off_cost ?? a.one_off_costs ?? 0;
  const afterCosts = ap?.backup.buffer_after_expense ?? a.buffer;
  const incomeAfter = ap ? ap.backup.income_after_actions - ap.backup.confirmed_extra_income : a.income;
  const spendingAfter = ap ? ap.backup.spending_after_actions + ap.backup.confirmed_monthly_cut : a.spending;
  const net = incomeAfter - spendingAfter;

  return (
    <section className="chart projection">
      <div className="projection-heading">
        <div>
          <h3>Your savings over time</h3>
          <p>What happens if this scenario continues for {n} months?</p>
        </div>
        <span className={'projection-pill' + (shortfall ? ' shortfall' : '')}>{shortfall ? 'Funding gap' : 'Covered'}</span>
      </div>
      <div className="projection-stats">
        <div><small>After immediate costs</small><strong>{cash(a.buffer)}</strong></div>
        <span aria-hidden="true">→</span>
        <div>
          <small>{end < 0 ? 'Unfunded by' : 'Projected at'} month {n}</small>
          <strong className={end < 0 ? 'projection-loss' : undefined}>{cash(Math.abs(end))}</strong>
        </div>
      </div>
      <svg viewBox="0 0 600 296" role="img"
        aria-label={`Savings projection: starts at ${cash(a.buffer)}, ends at ${cash(end)} after ${n} months. ${status}.`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f58220" stopOpacity=".24" />
            <stop offset="100%" stopColor="#f58220" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {grid.map(v => (
          <g key={v}>
            <line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} className="projection-grid" />
            <text x={LEFT - 12} y={y(v) + 4} textAnchor="end">{compactCash(v)}</text>
          </g>
        ))}
        <path d={positive.map(area).join(' ')} fill={`url(#${gradientId})`} />
        <path d={negative.map(area).join(' ')} fill="#c8344b" fillOpacity=".08" />
        <line x1={LEFT} x2={RIGHT} y1={y(0)} y2={y(0)} className="projection-zero" />
        <text x={LEFT - 12} y={y(0) + 4} textAnchor="end">$0</text>
        <path d={positive.map(path).join(' ')} className="projection-line" />
        <path d={negative.map(path).join(' ')} className="projection-line negative" />
        {values.map(p => {
          const label = `${p.month === 0 ? 'Now' : 'Month ' + p.month} · ${cash(Math.abs(p.value))}${p.value < 0 ? ' unfunded' : ' remaining'}`;
          return (
            <g key={p.month} className="projection-point" tabIndex={0} role="button" aria-label={label}
              onPointerEnter={e => show(e, label)} onPointerLeave={hide} onFocus={e => show(e, label)} onBlur={hide}
              onClick={e => show(e, label)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(e, label); } }}>
              <circle cx={x(p.month)} cy={y(p.value)} r="15" fill="transparent" />
              <circle cx={x(p.month)} cy={y(p.value)} r={p.month === 0 || p.month === n ? 5 : 3}
                fill={p.value < 0 ? '#c8344b' : '#f58220'} stroke="white" strokeWidth="2" />
            </g>
          );
        })}
        {shortfall && exhausted > 0 && (
          <circle cx={x(exhausted)} cy={y(0)} r="6" fill="white" stroke="#c8344b" strokeWidth="2">
            <title>Savings exhausted around month {exhausted.toFixed(1)}</title>
          </circle>
        )}
        {ticks.map(m => <text key={m} x={x(m)} y="268" textAnchor="middle">{m === 0 ? 'Now' : 'Mo ' + m}</text>)}
        <text x="322" y="291" textAnchor="middle">Months after shock</text>
      </svg>
      {tip && <div className="balance-tooltip" role="tooltip" ref={tipRef}>{tip.label}</div>}
      <div className={'projection-caption' + (shortfall ? ' projection-loss' : '')}><span className="projection-dot" />{status}</div>
      <p className="projection-note">
        {end < 0 && 'The dashed red line shows spending that savings cannot cover. '}
        {d.buffer_path ? 'Each change lasts only for its own duration. ' : 'Income and spending stay constant over this period. '}
        Hover, tap, or focus a point for its balance.
      </p>
      <details className="balance-calculation">
        <summary>How this balance is calculated</summary>
        <p>The starting buffer is the average daily account balance over the last six recorded months. It estimates funds already available; it is not money added every month.</p>
        <dl>
          <Row label="Historical starting buffer">{preciseCash(startBuffer)}</Row>
          <Row label="Immediate scenario costs">− {preciseCash(oneOff)}</Row>
          <Row label="Available after immediate costs">{preciseCash(afterCosts)}</Row>
          <Row label="Monthly income after the shock">{preciseCash(incomeAfter)}</Row>
          <Row label="Monthly spending after the shock">− {preciseCash(spendingAfter)}</Row>
          <Row label={d.buffer_path ? 'Month-one net change' : 'Net monthly change'}>{preciseCash(net)}</Row>
        </dl>
        {d.buffer_path ? (
          <>
            <div className="monthly-table-wrap">
              <table className="comparison">
                <thead><tr><th>Month</th><th>Change</th><th>Balance</th></tr></thead>
                <tbody>
                  {values.slice(1).map((p, i) => (
                    <tr key={p.month}><td>{p.month}</td><td>{preciseCash(p.value - values[i].value)}</td><td>{preciseCash(p.value)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>Each month's balance = the previous balance + that month's income − that month's spending. Temporary changes stop after their own duration.</p>
          </>
        ) : (
          <>
            <p className="balance-equation">Month {n}: {cash(a.buffer)} + ({cash(net)} × {n}) = <strong>{cash(end)}</strong></p>
            <p>Each month, income replenishes the balance and spending draws it down. The historical buffer is not added again.</p>
          </>
        )}
      </details>
    </section>
  );
}
