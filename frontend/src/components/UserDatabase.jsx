import { useState } from 'react';

const SHOWN = 60;

export default function UserDatabase({ hidden, ids, onOpen }) {
  const [search, setSearch] = useState('');
  const q = search.trim();
  const matching = ids.filter(id => String(id).includes(q));

  return (
    <section id="user-database" hidden={hidden}>
      <div className="database-banner">
        <p className="eyebrow">YOUR FINANCIAL WHAT-IF LAB</p>
        <h1>User database</h1>
        <p>Find a customer and open their money snapshot.</p>
        <span id="database-count">{ids.length.toLocaleString()} accounts · anonymized challenge data</span>
      </div>
      <div className="database-content">
        <label htmlFor="user-search">Search by account ID</label>
        <input id="user-search" type="search" placeholder="Enter an account ID…" value={search} onChange={e => setSearch(e.target.value)} />
        <p id="user-count" aria-live="polite">
          {matching.length.toLocaleString()} matching accounts
          {matching.length > SHOWN ? ` · first ${SHOWN} shown; search to narrow the list` : ''}
        </p>
        <div id="user-list">
          {matching.slice(0, SHOWN).map(id => (
            <button key={id} type="button" className="account-card" onClick={() => onOpen(id)}>
              <span>Account {id}<small>Open money snapshot</small></span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
