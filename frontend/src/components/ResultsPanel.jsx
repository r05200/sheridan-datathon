import { cash, preciseCash, runway } from '../format.js';
import Projection from './Projection.jsx';

// Time to the emergency-fund target, in words: uses the planning choices when the plan carries them.
function GoalTimeline({ plan }) {
  const g = plan.action_plan?.goal;
  const months = g ? g.months_to_goal : plan.goal_plan.months_to_goal;
  const contribution = g ? g.monthly_contribution : plan.goal_plan.monthly_savings_capacity;
  let title, detail;
  if (months === 0) {
    title = 'Already funded';
    detail = 'Your current buffer meets your emergency-fund target.';
  } else if (months != null && contribution > 0) {
    title = `${months} ${months === 1 ? 'month' : 'months'}`;
    detail = `By saving ${preciseCash(contribution)} each month from your normal income.`;
    if (g && !g.deadline_met_at_selected_contribution) detail += ` This is beyond your ${g.deadline_months}-month goal; increase saving or extend the deadline in Plan.`;
  } else if (g && g.baseline_monthly_surplus < 0) {
    title = 'Close the monthly gap first';
    detail = `Spending currently exceeds normal income by ${preciseCash(-g.baseline_monthly_surplus)}/month. To reach the fund in ${g.deadline_months} months, improve cash flow by ${preciseCash(g.monthly_cash_flow_improvement_for_deadline)}/month in total, including ${preciseCash(g.monthly_saving_for_deadline)} for saving.`;
  } else if (g && g.available_monthly_saving === 0) {
    title = 'Make room to save';
    detail = `Income currently covers spending with nothing left to save. Free up ${preciseCash(g.monthly_saving_for_deadline)}/month to reach the target in ${g.deadline_months} months.`;
  } else {
    title = 'Choose a saving amount';
    detail = 'Set a monthly contribution in Plan to calculate your timeline.';
  }
  return <div className="mini goal-timeline"><small>Time to build your emergency fund</small><strong>{title}</strong><p>{detail}</p></div>;
}

const Dropdown = ({ title, children }) => (
  <details className="explain-drop">
    <summary><h3>{title}</h3><span className="chevron" aria-hidden="true">▾</span></summary>
    <div className="explain-body">{children}</div>
  </details>
);

// One bullet per sentence; only splits where a sentence end is followed by a capital letter or $.
const sentences = text => (text || '').split(/(?<=[.!?])\s+(?=[A-Z$])/).map(s => s.trim()).filter(Boolean);

// part="findings" (Stress Test): what the scenario means. part="plan" (Plan tab): goal + contingency plan.
export function Explanation({ state, part = 'findings' }) {
  let body;
  if (!state || state.loading) body = <p>Preparing the explanation…</p>;
  else if (state.error) body = `Calculations are available. Explanation unavailable: ${state.error}`;
  else {
    const t = state.data;
    body = (
      <>
        {part === 'findings' ? (
          <div className="explain-card">
            <h3>What this means</h3>
            <ul>
              {sentences(t.summary).map(s => <li key={s}>{s}</li>)}
              {sentences(t.caveat).map(s => <li key={s} className="warning">{s}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <Dropdown title="Your goal"><p>{t.goal_plan_text}</p></Dropdown>
            <Dropdown title="Contingency plan"><p>{t.backup_plan_text}</p></Dropdown>
            {t.caveat && <p className="warning">{t.caveat}</p>}
          </>
        )}
        <small>Explanation source: {t.source}</small>
      </>
    );
  }
  return <div className="explanation">{body}</div>;
}

const Mini = ({ label, value }) => <div className="mini"><small>{label}</small><strong>{value}</strong></div>;

function PlanResults({ c, show }) {
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
    ['Immediate expense', 'Not applicable', cash(a.one_off_costs || 0)],
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
      {/* With a chart: chart ~60% wide, the four cards stacked on its right. Without: the usual 2x2 grid. */}
      <div className={d ? 'impact-row' : undefined}>
        {d && <Projection plan={p} />}
        <div className="mini-grid">
          <Mini label="Required monthly spending reduction" value={cash(p.backup_plan.monthly_cut_needed)} />
          <Mini label="Immediate funding needed" value={cash(p.backup_plan.upfront_funding_needed)} />
          <Mini label="Emergency-fund target" value={cash(p.goal_plan.target_amount)} />
          <GoalTimeline plan={p} />
        </div>
      </div>
      <Explanation state={c.explanation} />
      <div className="to-plan">
        <button type="button" onClick={() => show('plan')}>Make a plan for this scenario ↗</button>
      </div>
      <details className="data">
        <summary>Inspect all calculated values and account data</summary>
        <pre>{JSON.stringify({ account: b, plan: p }, null, 2)}</pre>
      </details>
      <p className="fine-print">Amounts are displayed as whole dollars. Estimates are scenario inputs, not observed category budgets.</p>
    </>
  );
}

export default function ResultsPanel({ c, show }) {
  return (
    <section className={'results-panel' + (c.plan ? ' revealed' : '')}>
      <div className="panel-heading">
        <div>
          <h2>See the impact</h2>
          <p id="result-label">{c.plan ? 'Baseline versus your applied scenario.' : 'Your baseline, before a shock.'}</p>
        </div>
      </div>
      <div id="results">
        {c.plan ? <PlanResults c={c} show={show} /> : (
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
