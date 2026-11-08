import { useRef, useState } from 'react';

const PAGE_SIZE = 36;  // divisible by 4, 3, 2 and 1, so every column layout fills its last row

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

export default function UserDatabase({ hidden, ids, onOpen }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const listTop = useRef(null);
  const q = search.trim();
  const matching = ids.filter(id => String(id).includes(q));
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
        <p className="eyebrow">YOUR FINANCIAL WHAT-IF LAB</p>
        <h1>User database</h1>
        <p>Find a customer and open their money snapshot.</p>
        <span id="database-count">{ids.length.toLocaleString()} accounts · anonymized challenge data</span>
      </div>
      <div className="database-content" ref={listTop}>
        <label htmlFor="user-search">Search by account ID</label>
        <input id="user-search" type="search" placeholder="Enter an account ID…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <p id="user-count" aria-live="polite">
          {matching.length.toLocaleString()} matching accounts
          {matching.length > PAGE_SIZE
            ? ` · showing ${(start + 1).toLocaleString()}–${(start + shown.length).toLocaleString()} · page ${current} of ${totalPages}`
            : ''}
        </p>
        <div id="user-list">
          {shown.map(id => (
            <button key={id} type="button" className="account-card" onClick={() => onOpen(id)}>
              <span>Account {id}<small>Open money snapshot</small></span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        <Pagination page={current} total={totalPages} onPage={goTo} />
      </div>
    </section>
  );
}
