import { cash, runway } from '../format.js';
import ActionPlan from './ActionPlan.jsx';

function Chart({ plan }) {
  const n = plan.duration_assessment.months;
  const a = plan.after_shock;
  const vals = Array.from({ length: n + 1 }, (_, i) => a.buffer + i * (a.income - a.spending));
  const hi = Math.max(1, ...vals);
  const lo = Math.min(0, ...vals);
  const y = v => 20 + ((hi - v) / (hi - lo)) * 110;
  const x = i => 20 + (i / n) * 360;
  return (
    <div className="chart">
      <h3>Buffer through the scenario</h3>
      <small>Approximation from rounded API values. Negative values represent unfunded spending, not approved borrowing.</small>
      <svg viewBox="0 0 400 165" role="img" aria-label={`Projected buffer over ${n} months`}>
        <line x1="20" y1={y(0)} x2="380" y2={y(0)} stroke="#cbd6ca" strokeDasharray="4" />
        <polyline points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="#1c594b" strokeWidth="3" />
        <circle cx="380" cy={y(vals[n])} r="4" fill="#f0854e" />
        <text x="20" y="157" fontSize="10" fill="#65746d">Now</text>
        <text x="325" y="157" fontSize="10" fill="#65746d">Month {n}</text>
      </svg>
    </div>
  );
}

function Explanation({ state }) {
  let body;
  if (!state || state.loading) body = <p>Preparing the explanation…</p>;
  else if (state.error) body = `Calculations are available. Explanation unavailable: ${state.error}`;
  else {
    const t = state.data;
    body = (
      <>
        <h3>What this means</h3><p>{t.summary}</p>
        <h3>Your goal</h3><p>{t.goal_plan_text}</p>
        <h3>Contingency plan</h3><p>{t.backup_plan_text}</p>
        {t.caveat && <p className="warning">{t.caveat}</p>}
        <small>Explanation source: {t.source}</small>
      </>
    );
  }
  return <div id="explanation" className="explanation">{body}</div>;
}

const Mini = ({ label, value }) => <div className="mini"><small>{label}</small><strong>{value}</strong></div>;

// Children stay direct descendants of #results: the Plan view's CSS hides all but .action-plans and .explanation.
function PlanResults({ c }) {
  const p = c.plan;
  const b = c.baseline;
  const a = p.after_shock;
  const d = p.duration_assessment;
  const rows = [
    ['Monthly inflows', cash(p.baseline.income), cash(a.income)],
    ['Monthly spending', cash(p.baseline.spending), cash(a.spending)],
    ['Buffer after immediate costs', cash(p.baseline.buffer), cash(a.buffer)],
    ['Monthly shortfall', cash(Math.max(b.spending - b.income, 0)), cash(a.monthly_gap)],
    ['Runway', runway(p.baseline), runway(a)],
    ['Immediate expense', '—', cash(a.one_off_costs || 0)],
  ];
  return (
    <>
      <table className="comparison">
        <thead><tr><th>Account {c.account}</th><th>Before</th><th>After</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
      </table>
      {d && (
        <div className={'outcome' + (d.covers_duration ? '' : ' danger')}>
          <h3>{d.covers_duration ? 'Covered' : 'Funding gap'} over {d.months} months</h3>
          <p>{d.assumption}</p>
          <div className="mini-grid">
            <Mini label="Required starting buffer" value={cash(d.required_starting_buffer)} />
            <Mini label="Additional buffer needed" value={cash(d.additional_buffer_needed)} />
          </div>
        </div>
      )}
      {d && <Chart plan={p} />}
      <div className="mini-grid">
        <Mini label="Required monthly spending reduction" value={cash(p.backup_plan.monthly_cut_needed)} />
        <Mini label="Immediate funding needed" value={cash(p.backup_plan.upfront_funding_needed)} />
        <Mini label="Emergency-fund target" value={cash(p.goal_plan.target_amount)} />
        <Mini label="Time to goal at baseline surplus" value={p.goal_plan.months_to_goal === null ? 'Not reachable' : p.goal_plan.months_to_goal + ' months'} />
      </div>
      {p.action_plan && (
        <ActionPlan key={c.planVersion} plan={p} planning={c.planning} busy={c.busy} error={c.planningError} onSubmit={c.recalculatePlan} />
      )}
      <Explanation state={c.explanation} />
      <details className="data">
        <summary>Inspect all calculated values and account data</summary>
        <pre>{JSON.stringify({ account: b, plan: p }, null, 2)}</pre>
      </details>
      <p style={{ fontSize: 10, color: 'var(--muted)' }}>Amounts are displayed as whole dollars. Estimates are scenario inputs, not observed category budgets.</p>
    </>
  );
}

export default function ResultsPanel({ c }) {
  return (
    <section className={'results-panel' + (c.plan ? ' revealed' : '')}>
      <div className="panel-heading">
        <div>
          <h2>See the impact</h2>
          <p id="result-label">{c.plan ? 'Baseline versus your applied scenario.' : 'Your baseline, before a shock.'}</p>
        </div>
      </div>
      <div id="results">
        {c.plan ? <PlanResults c={c} /> : (
          <>
            <div className="empty">
              <div className="empty-icon">↗</div>
              <h3>One change can tell a bigger story.</h3>
              <p>Describe a scenario to compare your starting point<br />with what happens next.</p>
            </div>
            <details className="data">
              <summary>Explore the full account baseline</summary>
              <pre>{JSON.stringify(c.baseline, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
