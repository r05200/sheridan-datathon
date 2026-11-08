import { baselineRunway, cash, runway } from '../format.js';
import ChatPanel from './ChatPanel.jsx';
import ResultsPanel from './ResultsPanel.jsx';

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

export default function Dashboard({ hidden, view, show, c, accountInput, setAccountInput }) {
  const b = c.baseline;
  const planEmpty = view === 'plan' && !c.plan?.action_plan;

  function submitAccount(e) {
    e.preventDefault();
    if (!c.busy) c.loadAccount(Number(accountInput));
  }

  return (
    <main id="dashboard" hidden={hidden}>
      <section className="intro">
        <div>
          <p className="eyebrow">YOUR FINANCIAL WHAT-IF LAB</p>
          <h1>Your money,<br />a little clearer.</h1>
          <p className="sub">Explore an account. Apply a shock. Find the buffer you need.</p>
        </div>
        <form id="account-form" className="account-box" onSubmit={submitAccount}>
          <label htmlFor="account-id">ACCOUNT</label>
          <div className="account-input">
            <input id="account-id" type="number" min="1" list="accounts" required aria-label="Account ID"
              value={accountInput} onChange={e => setAccountInput(e.target.value)} disabled={c.busy} />
            <datalist id="accounts">{c.accountIds.map(id => <option key={id} value={id} />)}</datalist>
            <button type="submit" disabled={c.busy}>Load account ↗</button>
          </div>
          <small id="account-meta">
            {b ? `${b.months_of_history} observed months · Active loan payment ${cash(b.loan_payment)}/month` : 'Loading account…'}
          </small>
        </form>
      </section>

      <div id="page-error" className="notice error" role="alert" hidden={!c.pageError}>{c.pageError}</div>

      <section id="customer-snapshot" aria-labelledby="snapshot-title">
        <div className="section-title">
          <h2 id="snapshot-title">Your starting point</h2>
          <span>Typical monthly values · CAD</span>
        </div>
        <Metrics baseline={b} plan={c.plan} />
      </section>

      <div className="workspace" hidden={planEmpty}>
        <ChatPanel c={c} />
        <ResultsPanel c={c} />
      </div>

      <div id="plan-empty" className="empty" hidden={!planEmpty}>
        <h2>Build a plan from your own numbers.</h2>
        <p>Apply a scenario in Stress Test to calculate your goal and backup plans.</p>
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
