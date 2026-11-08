import { useEffect, useRef, useState } from 'react';
import { api, preciseCash } from '../format.js';

const cache = new Map();   // account id -> result, so recalculating a plan does not refetch

function Method({ method }) {
  return (
    <details>
      <summary>How these accounts were matched</summary>
      <p>{method.description}</p>
      <p>The comparison uses monthly account metrics, not individual purchase categories. Loan matching uses payment amounts, not loan balances or interest rates. Household size and location are not part of the match.</p>
    </details>
  );
}

// Spending benchmarks against the closest accounts by income, fixed costs and loan payment.
// With a backup plan on screen, a reviewed reduction can be copied into its "confirmed spending reduction".
export default function PeerComparison({ account, spendingCap, currentCut, onUseCut }) {
  const [data, setData] = useState(() => cache.get(account) ?? null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const choice = useRef(null);

  useEffect(() => {
    let active = true;
    setError('');
    setStatus('');
    if (cache.has(account)) { setData(cache.get(account)); return undefined; }
    setData(null);
    api(`/api/accounts/${account}/peers`)
      .then(result => { cache.set(account, result); if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [account]);

  if (error) {
    return (
      <section className="peer-comparison" aria-labelledby="peer-comparison-title">
        <h3 id="peer-comparison-title">Peer comparison unavailable</h3>
        <p>{error}</p>
        <p>Your own account plan is still available.</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="peer-comparison" aria-labelledby="peer-comparison-title" aria-busy="true">
        <h3 id="peer-comparison-title">Find areas to review</h3>
        <p>Finding accounts with similar income, fixed costs and loan payments…</p>
      </section>
    );
  }
  if (data.status !== 'ok') {
    return (
      <section className="peer-comparison" aria-labelledby="peer-comparison-title">
        <p className="eyebrow">PEER COMPARISON</p>
        <h3 id="peer-comparison-title">Find areas to review</h3>
        <p>{data.message}</p>
        <Method method={data.method} />
      </section>
    );
  }

  const above = data.comparisons.filter(c => c.above_median).sort((a, b) => b.difference - a.difference);

  function useCut() {
    const input = choice.current;
    if (!input?.reportValidity()) return;
    const value = Number(input.value);
    onUseCut(value);
    setStatus(`${preciseCash(value)}/month entered in your backup budget. Select “Recalculate my plans” to test it.`);
  }

  return (
    <section className="peer-comparison" aria-labelledby="peer-comparison-title">
      <p className="eyebrow">PEER COMPARISON · {data.peer_count} SIMILAR ACCOUNTS</p>
      <h3 id="peer-comparison-title">Where could you spend less?</h3>
      <p>{data.message}</p>
      <div className="peer-table-wrap">
        <table className="comparison">
          <thead><tr><th>Monthly area</th><th>You</th><th>Peer median</th><th>Difference</th></tr></thead>
          <tbody>
            {data.comparisons.map(c => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td>{preciseCash(c.your_amount)}</td>
                <td>{preciseCash(c.peer_median)}</td>
                <td className={c.above_median ? 'above-median' : undefined}>{c.above_median ? '+' : ''}{preciseCash(c.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {above.length ? (
        <>
          <h4>Start by reviewing these areas</h4>
          <div className="peer-review-list">
            {above.map(c => (
              <article key={c.key}>
                <strong>{c.label} · {preciseCash(c.difference)} above the median</strong>
                <p>{c.review}</p>
              </article>
            ))}
          </div>
          {onUseCut && (
            <div className="peer-budget-choice">
              {/* No name attribute: this input must not be posted with the planning form. */}
              <label>After reviewing your spending, how much could you reduce per month?
                <input ref={choice} type="number" min="0" max={spendingCap} step="0.01" defaultValue={currentCut ?? 0} />
              </label>
              <button type="button" onClick={useCut}>Use this in my backup budget</button>
              <p role="status">{status}</p>
            </div>
          )}
        </>
      ) : (
        <p>No measured area is above this peer median. That does not guarantee the current budget is affordable; use your own costs and goal to decide what to change.</p>
      )}
      <p className="peer-note">An above-median amount is a review opportunity, not proof of overspending. Total outflow includes overlapping channels; do not add their gaps together. No cuts are applied automatically.</p>
      <Method method={data.method} />
    </section>
  );
}
