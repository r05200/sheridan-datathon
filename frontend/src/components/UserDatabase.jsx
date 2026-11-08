import { useEffect, useRef, useState } from 'react';
import { api, cash, runway } from '../format.js';
import PortfolioSummary from './PortfolioSummary.jsx';

const PAGE_SIZE = 36;  // divisible by 4, 3, 2 and 1, so every column layout fills its last row
const FILTERS = [
  ['all', 'All accounts'],
  ['troubled_loans_healthy', 'Defaulted/debt loan · no formula shortfall'],
  ['no_loan_negative', 'No loan · prior negative balance'],
  ['negative', 'Any prior negative-balance month'],
  ['watchlist', 'Never-negative watchlist'],
];

// Page numbers to show: first, last, and the current page with its neighbours; '…' fills larger gaps.
// e.g. page 1 of 40 → 1 2 3 … 40; page 7 → 1 … 6 7 8 … 40; page 40 → 1 … 38 39 40.
function pageItems(page, total) {
  const keep = new Set([1, total, page - 1, page, page + 1]);
  if (page <= 2) keep.add(3);
  if (page >= total - 1) keep.add(total - 2);
  const nums = [...keep].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items = [];
  nums.forEach((n, i) => {
    const prev = nums[i - 1];
    if (prev && n - prev === 2) items.push(prev + 1);  // a single hidden page: show it rather than '…'
    else if (prev && n - prev > 2) items.push('gap-' + n);
    items.push(n);
  });
  return items;
}

function Pagination({ page, total, onPage }) {
  if (total <= 1) return null;
  return (
    <nav className="pagination" aria-label="Account pages">
      <button type="button" className="page-step" disabled={page === 1} onClick={() => onPage(page - 1)}>← Prev</button>
      {pageItems(page, total).map(item => (typeof item === 'number'
        ? <button key={item} type="button" className="page-number" aria-current={item === page ? 'page' : undefined}
            aria-label={`Page ${item}`} onClick={() => onPage(item)}>{item}</button>
        : <span key={item} className="page-gap" aria-hidden="true">…</span>))}
      <button type="button" className="page-step" disabled={page === total} onClick={() => onPage(page + 1)}>Next →</button>
    </nav>
  );
}

export default function UserDatabase({ hidden, onOpen }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [directory, setDirectory] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const listTop = useRef(null);
  useEffect(() => {
    let active = true;
    setDirectory(null);
    setError('');
    api('/api/tangerine/accounts?filter=' + encodeURIComponent(filter))
      .then(result => { if (active) setDirectory(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [filter]);

  const q = search.trim();
  const matching = (directory?.accounts || []).filter(account => String(account.account_id).includes(q));
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const shown = matching.slice(start, start + PAGE_SIZE);

  function goTo(n) {
    setPage(n);
    listTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  return (
    <section id="user-database" hidden={hidden}>
      <div className="database-banner">
        <p className="eyebrow">YOUR FINANCIAL MONITORING LAB</p>
        <h1>Account directory</h1>
        <p>Explore portfolio patterns, then open an account’s financial history.</p>
        <span id="database-count">{directory ? `${directory.total_accounts.toLocaleString()} accounts · data through ${directory.as_of}` : 'Loading account directory…'}</span>
      </div>
      <div className="database-content">
        <PortfolioSummary />
      </div>
      <div className="database-content" ref={listTop}>
        <div className="directory-controls">
          <label htmlFor="user-search">Search by account ID
            <input id="user-search" type="search" placeholder="Enter an account ID…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </label>
          <label htmlFor="account-filter">Explore a cohort
            <select id="account-filter" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
              {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="notice error" role="alert">Account directory unavailable: {error}</p>}
        <p id="user-count" aria-live="polite">
          {directory ? `${matching.length.toLocaleString()} ${directory.filter_label.toLowerCase()}` : 'Loading matching accounts…'}
          {matching.length > PAGE_SIZE
            ? ` · showing ${(start + 1).toLocaleString()} to ${(start + shown.length).toLocaleString()} · page ${current} of ${totalPages}`
            : ''}
        </p>
        <div id="user-list">
          {shown.map(account => (
            <button key={account.account_id} type="button" className="account-card directory-account" onClick={() => onOpen(account.account_id)}>
              <span className="directory-account-identity">
                <strong>Account {account.account_id}</strong>
                <small>Latest balance {cash(account.latest_balance)}</small>
              </span>
              <span className="directory-runway">{runway(account)}</span>
              <span className="directory-indicators">
                {account.past_negative_month && <i className="indicator warning" title="Prior negative-balance month" aria-label="Prior negative-balance month">!</i>}
                {['B', 'D'].includes(account.loan_status) && <i className="indicator priority" title={account.loan_status_meaning} aria-label={account.loan_status_meaning}>↗</i>}
              </span>
              <span className="directory-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        {directory && shown.length === 0 && <p className="empty">No accounts match this search.</p>}
        <Pagination page={current} total={totalPages} onPage={goTo} />
      </div>
    </section>
  );
}
