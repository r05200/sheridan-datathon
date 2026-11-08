import { baselineRunway, cash, runway } from '../format.js';
import ChatPanel from './ChatPanel.jsx';
import ResultsPanel, { Explanation } from './ResultsPanel.jsx';
import ActionPlan from './ActionPlan.jsx';
import AccountInsights from './AccountInsights.jsx';
import PlanContext from './PlanContext.jsx';

// Plan tab: the goal plan always; with an applied scenario, a one-line scenario card on top plus the backup plan.
function PlanView({ c, plan, show }) {
  return (
    <div className="plan-view">
      <ActionPlan key={c.planVersion} plan={plan} scenario={c.plan} onEditScenario={() => show('stress')}
        planning={c.planning} busy={c.busy} error={c.planningError} onSubmit={c.recalculatePlan} />
      <PlanContext plan={plan} />
      {c.plan ? <Explanation state={c.explanation} /> : (
        <div className="add-stress">
          <p>Want to see how a job loss, rent hike or surprise bill would change this? Add a stress test to get a backup plan.</p>
          <button type="button" onClick={() => show('stress')}>Add a stress test ↗</button>
        </div>
      )}
    </div>
  );
}

function Metrics({ baseline: b, plan }) {
  if (!b) return <div id="metrics" className="metrics" />;
  const base = plan?.baseline || baselineRunway(b);
  const cards = [
    ['Monthly inflows', cash(b.income), 'Median recorded money in'],
    ['Monthly spending', cash(b.spending), 'Median recorded money out'],
    ['Household bills', cash(b.household_bills), 'Recorded category, not rent alone'],
    ['Fixed costs', cash(b.fixed_costs), 'Median of monthly bills + insurance + loans'],
    ['Savings buffer', cash(b.buffer), 'Mean balance over last six months'],
    ['Baseline runway', runway(base), base.runway_capped ? 'Capped at 120 months' : 'Under typical conditions'],
  ];
  return (
    <div id="metrics" className="metrics">
      {cards.map(([label, value, note], i) => (
        <div key={label} className={'metric' + (i === 4 ? ' highlight' : '')}>
          <label>{label}</label><strong>{value}</strong><small>{note}</small>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ hidden, view, show, isAdmin, c, accountInput, setAccountInput }) {
  const b = c.baseline;
  const activePlan = c.plan?.action_plan ? c.plan : c.basePlan?.action_plan ? c.basePlan : null;
  const planEmpty = view === 'plan' && !activePlan;
  const meta = b ? `${b.months_of_history} months on record · Loan payment ${cash(b.loan_payment)} per month` : 'Loading account...';

  function submitAccount(e) {
    e.preventDefault();
    if (isAdmin && !c.busy) c.loadAccount(Number(accountInput));
  }

  return (
    <main id="dashboard" hidden={hidden}>
      <section className="intro">
        <div>
          <p className="eyebrow">YOUR FINANCIAL WHAT-IF LAB</p>
          <h1>Your money,<br />a little clearer.</h1>
          <p className="sub">Explore an account. Apply a shock. Find the buffer you need.</p>
        </div>
        {/* Same card in both modes; customers see their account ID read-only and get no Load button. */}
        <form id="account-form" className="account-box" onSubmit={submitAccount}>
          <label htmlFor="account-id">ACCOUNT</label>
          <div className="account-input">
            <input id="account-id" type="number" min="1" list={isAdmin ? 'accounts' : undefined} required aria-label="Account ID"
              value={isAdmin ? accountInput : c.account} onChange={e => setAccountInput(e.target.value)}
              readOnly={!isAdmin} disabled={c.busy} />
            {isAdmin && <datalist id="accounts">{c.accountIds.map(id => <option key={id} value={id} />)}</datalist>}
            {isAdmin && <button type="submit" disabled={c.busy}>Load account ↗</button>}
          </div>
          <small id="account-meta">{meta}</small>
        </form>
      </section>

      <div id="page-error" className="notice error" role="alert" hidden={!c.pageError}>{c.pageError}</div>

      <section id="customer-snapshot" aria-labelledby="snapshot-title">
        <div className="section-title">
          <h2 id="snapshot-title">Your starting point</h2>
          <span>Typical monthly values · CAD</span>
        </div>
        <Metrics baseline={b} plan={c.plan} />
        <AccountInsights baseline={b} />
      </section>

      {/* Kept mounted on the Plan tab so the chat survives switching back. */}
      <div className="workspace" hidden={view === 'plan'}>
        <ChatPanel c={c} />
        <ResultsPanel c={c} show={show} />
      </div>

      {view === 'plan' && activePlan && <PlanView c={c} plan={activePlan} show={show} />}

      <div id="plan-empty" className="empty" hidden={!planEmpty}>
        <h2>Build a plan from your own numbers.</h2>
        <p>{b ? 'Calculating your goal plan…' : 'Load an account to calculate your goal plan.'} Apply a scenario in Stress Test to add a backup plan.</p>
        <button type="button" onClick={() => show('stress')}>Create a stress test ↗</button>
      </div>

      <footer>
        <span>CUSHION / SHERIDAN DATATHON 2026</span>
        <span>Scenario analysis using anonymized account data. Recorded inflows are not verified salary.</span>
        <a href="/docs">API docs ↗</a>
      </footer>
    </main>
  );
}
