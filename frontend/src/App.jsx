import { useEffect, useState } from 'react';
import { useCushion } from './useCushion.js';
import Welcome from './components/Welcome.jsx';
import UserDatabase from './components/UserDatabase.jsx';
import Dashboard from './components/Dashboard.jsx';

const VIEWS = ['users', 'customer', 'stress', 'plan'];
const TABS = [['users', '← Accounts'], ['customer', 'Customer'], ['stress', 'Stress Test'], ['plan', 'Plan']];
const MODE_KEY = 'cushion:mode';

function readMode() {
  try { return localStorage.getItem(MODE_KEY) === 'user' ? 'user' : 'admin'; } catch { return 'admin'; }
}

export default function App() {
  const c = useCushion();
  const [view, setView] = useState('start');
  const [mode, setMode] = useState(readMode);
  const [accountInput, setAccountInput] = useState(String(c.account));
  const isAdmin = mode === 'admin';
  // Only admins can browse the account list; customers land on their own snapshot.
  const home = isAdmin ? 'users' : 'customer';
  const tabs = isAdmin ? TABS : TABS.filter(([v]) => v !== 'users');

  // The stylesheet switches layouts on body[data-view=...].
  useEffect(() => { document.body.dataset.view = view; }, [view]);

  function show(next) {
    setView(VIEWS.includes(next) && (isAdmin || next !== 'users') ? next : home);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function toggleMode() {
    const next = isAdmin ? 'user' : 'admin';
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* per-viewer convenience only */ }
    if (next === 'user' && view === 'users') setView('customer');
  }

  function openAccount(id) {
    setAccountInput(String(id));
    if (!c.busy) c.loadAccount(id);
    show('customer');
  }

  return (
    <>
      {view === 'start' && <Welcome onDone={() => show(home)} />}
      <div id="app-shell" hidden={view === 'start'}>
        <header>
          <a className="brand" href="/" aria-label="Cushion home" onClick={e => { e.preventDefault(); show(home); }}>
            <img className="brand-pillow" src="/pillow.PNG" alt="" /> Cushion
          </a>
          <span className="header-note">TANGERINE / RESILIENCE REWIRED</span>
          <button type="button" className="mode-switch" role="switch" aria-checked={isAdmin}
            aria-label="Admin mode" onClick={toggleMode}>
            <span className="mode-label">{isAdmin ? 'Admin' : 'Customer'}</span>
            <span className="mode-track" aria-hidden="true"><span className="mode-thumb" /></span>
          </button>
        </header>
        <nav className="cushion-tabs" aria-label="Workspace">
          {tabs.map(([v, label]) => (
            <button key={v} type="button" aria-current={view === v ? 'page' : undefined} onClick={() => show(v)}>{label}</button>
          ))}
        </nav>
        {isAdmin && <UserDatabase hidden={view !== 'users'} ids={c.accountIds} onOpen={openAccount} />}
        <Dashboard
          hidden={view === 'users'}
          view={view}
          show={show}
          isAdmin={isAdmin}
          c={c}
          accountInput={accountInput}
          setAccountInput={setAccountInput}
        />
      </div>
    </>
  );
}
