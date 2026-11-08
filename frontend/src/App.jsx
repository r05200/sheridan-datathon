import { useEffect, useState } from 'react';
import { useCushion } from './useCushion.js';
import Welcome from './components/Welcome.jsx';
import UserDatabase from './components/UserDatabase.jsx';
import Dashboard from './components/Dashboard.jsx';

const VIEWS = ['users', 'customer', 'stress', 'plan'];
const TABS = [['users', '← Accounts'], ['customer', 'Customer'], ['stress', 'Stress Test'], ['plan', 'Plan']];

export default function App() {
  const c = useCushion();
  const [view, setView] = useState('start');
  const [accountInput, setAccountInput] = useState(String(c.account));

  // The stylesheet switches layouts on body[data-view=...].
  useEffect(() => { document.body.dataset.view = view; }, [view]);

  function show(next) {
    setView(VIEWS.includes(next) ? next : 'users');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openAccount(id) {
    setAccountInput(String(id));
    if (!c.busy) c.loadAccount(id);
    show('customer');
  }

  return (
    <>
      {view === 'start' && <Welcome onDone={() => show('users')} />}
      <div id="app-shell" hidden={view === 'start'}>
        <header>
          <a className="brand" href="/" aria-label="Cushion home" onClick={e => { e.preventDefault(); show('users'); }}>
            <img className="brand-pillow" src="/pillow.PNG" alt="" /> Cushion
          </a>
          <span className="header-note">TANGERINE / RESILIENCE REWIRED</span>
          <span id="health" className="badge">{c.health}</span>
        </header>
        <nav className="cushion-tabs" aria-label="Workspace">
          {TABS.map(([v, label]) => (
            <button key={v} type="button" aria-current={view === v ? 'page' : undefined} onClick={() => show(v)}>{label}</button>
          ))}
        </nav>
        <UserDatabase hidden={view !== 'users'} ids={c.accountIds} onOpen={openAccount} />
        <Dashboard
          hidden={view === 'users'}
          view={view}
          show={show}
          c={c}
          accountInput={accountInput}
          setAccountInput={setAccountInput}
        />
      </div>
    </>
  );
}
