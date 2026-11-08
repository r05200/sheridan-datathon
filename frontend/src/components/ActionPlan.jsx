import { useRef } from 'react';
import { preciseCash, runway } from '../format.js';
import PeerComparison from './PeerComparison.jsx';

const GOAL_STATUS = {
  target_met: 'Target already met', no_surplus: 'Restore cash flow first',
  no_contribution: 'Choose a saving amount', saving: 'Build your buffer',
};
const BACKUP_STATUS = {
  immediate_funding_gap: 'Immediate funding still needed', covered: 'Proposed budget covers the shock',
  funding_gap: 'More changes are needed', stabilized: 'Monthly cash flow is balanced',
  needs_duration: 'Choose a horizon to check coverage',
};

const Row = ({ label, children }) => <div><dt>{label}</dt><dd>{children}</dd></div>;

function timeToGoal(m) {
  if (m === null) return 'Not reachable yet';
  if (m === 0) return 'Already funded';
  return m + ' whole months';
}

// One-line summary of the applied stress-test scenario, shown above the plans.
function ScenarioCard({ plan, onEdit }) {
  return (
    <div className="scenario-card">
      <span className="eyebrow">SCENARIO APPLIED</span>
      <strong title={plan.shock.label}>{plan.shock.label}</strong>
      <span className="scenario-runway">Runway {runway(plan.baseline)} → {runway(plan.after_shock)}</span>
      <button type="button" onClick={onEdit}>Edit in Stress Test ↗</button>
    </div>
  );
}

// Goal plan always; the backup plan only once a stress-test scenario is applied (scenario = that plan).
// Inputs are uncontrolled and reset (via the parent's key) after each recalculation.
export default function ActionPlan({ plan, scenario, account, onEditScenario, planning, busy, error, onSubmit }) {
  const { goal: g, backup: b } = plan.action_plan;
  const form = useRef(null);

  function submit(e) {
    e.preventDefault();
    const settings = {};
    for (const [k, v] of new FormData(e.currentTarget)) settings[k] = v === '' ? null : Number(v);
    onSubmit(settings);
  }

  // A reduction chosen in the peer comparison goes into the backup plan's input; the user still recalculates.
  function useCut(value) {
    const input = form.current?.elements.namedItem('confirmed_monthly_cut');
    if (input) input.value = value;
  }

  return (
    <section className="action-plans" aria-labelledby="make-plan-title">
      <div className="section-title">
        <h2 id="make-plan-title">Make a plan</h2>
        <span>Calculated from this account</span>
      </div>
      {scenario && <ScenarioCard plan={scenario} onEdit={onEditScenario} />}
      <form id="planning-form" className={scenario ? undefined : 'single'} onSubmit={submit} ref={form}>
        <article className="plan-card">
          <p className="eyebrow">BEFORE A SHOCK</p>
          <h3>Your goal plan</h3>
          <p className="plan-status">{GOAL_STATUS[g.status]}</p>
          <div className="form-grid">
            <label>Emergency fund (months of normal spending)
              <input name="target_months" type="number" min="1" step="1" defaultValue={g.target_months} required disabled={busy} />
            </label>
            <label>Goal deadline (months)
              <input name="deadline_months" type="number" min="1" max="120" step="1" defaultValue={g.deadline_months} required disabled={busy} />
            </label>
            <label>Monthly saving contribution ($)
              <input name="monthly_contribution" type="number" min="0.01" max="1000000" step="0.01" disabled={busy}
                defaultValue={planning.monthly_contribution ?? ''} placeholder={`Automatic: ${g.available_monthly_saving.toFixed(2)}`} />
            </label>
          </div>
          <div className="goal-progress"><div style={{ width: `${g.progress_pct}%` }} /></div>
          <small>{g.progress_pct}% of target covered by the current buffer</small>
          <dl className="plan-numbers">
            <Row label="Target buffer">{preciseCash(g.target_amount)}</Row>
            <Row label="Still to build">{preciseCash(g.amount_still_needed)}</Row>
            <Row label="Available monthly surplus">{preciseCash(g.available_monthly_saving)}</Row>
            <Row label="Selected monthly saving">{preciseCash(g.monthly_contribution)}</Row>
            <Row label="Time at this saving pace">{timeToGoal(g.months_to_goal)}</Row>
            <Row label="Saving needed for your deadline">{preciseCash(g.monthly_saving_for_deadline)}/month</Row>
          </dl>
          <ol className="plan-steps">{g.steps.map(x => <li key={x}>{x}</li>)}</ol>
          <small>{g.assumption}</small>
        </article>

        {scenario && <article className="plan-card">
          <p className="eyebrow">IF THE SHOCK HITS</p>
          <h3>Your backup plan</h3>
          <p className="plan-status">{BACKUP_STATUS[b.status]}</p>
          <p className="plan-help">Enter changes you can realistically make. These test a backup budget; they do not alter the original shock above.</p>
          <div className="form-grid">
            <label>Confirmed spending reduction ($/month)
              <input name="confirmed_monthly_cut" type="number" min="0" max="1000000" step="0.01" defaultValue={b.confirmed_monthly_cut} required disabled={busy} />
            </label>
            <label>Confirmed extra income ($/month)
              <input name="confirmed_extra_income" type="number" min="0" max="1000000" step="0.01" defaultValue={b.confirmed_extra_income} required disabled={busy} />
            </label>
            <label>Confirmed upfront funds ($)
              <input name="confirmed_upfront_funds" type="number" min="0" max="1000000" step="0.01" defaultValue={b.confirmed_upfront_funds} required disabled={busy} />
            </label>
          </div>
          <dl className="plan-numbers">
            <Row label="Immediate funding still needed">{preciseCash(b.remaining_immediate_funding_gap)}</Row>
            <Row label="Monthly income after your actions">{preciseCash(b.income_after_actions)}</Row>
            <Row label="Monthly spending after your actions">{preciseCash(b.spending_after_actions)}</Row>
            <Row label="Remaining monthly shortfall">{preciseCash(b.monthly_gap_after_actions)}</Row>
            <Row label="Further monthly improvement needed">{preciseCash(b.additional_monthly_improvement_needed)}</Row>
            <Row label={`Monthly spending ceiling ${b.duration_months ? 'for ' + b.duration_months + ' months' : 'to stop drawing down savings'}`}>
              {preciseCash(b.maximum_monthly_spending_for_horizon)}
            </Row>
            {b.duration_months ? (
              <>
                <Row label="Projected end balance after actions">{preciseCash(b.ending_buffer_after_actions)}</Row>
                <Row label="Additional buffer without further monthly changes">{preciseCash(b.additional_buffer_for_horizon)}</Row>
              </>
            ) : null}
          </dl>
          <ol className="plan-steps">{b.steps.map(x => <li key={x}>{x}</li>)}</ol>
          <small>{b.assumption}</small>
        </article>}

        <PeerComparison account={account} spendingCap={scenario?.after_shock.spending}
          currentCut={scenario ? b.confirmed_monthly_cut : 0} onUseCut={scenario ? useCut : undefined} />

        <p id="planning-error" className="notice error" role="alert" hidden={!error}>{error}</p>
        <button type="submit" disabled={busy}>Recalculate my plans ↗</button>
        <p className="plan-help">Goal and backup inputs are editable planning choices. They are not inferred expenses or guaranteed future income.</p>
      </form>
    </section>
  );
}
