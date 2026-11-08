import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './format.js';

const GREETING = 'What would you like to stress-test? I’ll ask for an estimate if the account data doesn’t identify a cost.';
const REPLACED = 'This interpretation has been replaced. Use the latest scenario.';
const DEFAULT_ACCOUNT = 20134;

const recentKey = id => 'runway:recentQueries:' + id;
function readRecent(id) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(recentKey(id)) || '[]');
    return Array.isArray(saved) ? saved.filter(q => typeof q === 'string' && q.trim() && q.length <= 500).slice(0, 2) : [];
  } catch { return []; }
}

// All app state and the API workflow: load an account, interpret a shock, clarify, apply, re-plan.
export function useCushion() {
  const [health, setHealth] = useState('Connecting…');
  const [accountIds, setAccountIds] = useState([]);
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [baseline, setBaseline] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planVersion, setPlanVersion] = useState(0);
  const [planning, setPlanning] = useState({});
  const [explanation, setExplanation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [recentQueries, setRecentQueries] = useState([]);
  const [busy, setBusyState] = useState(false);
  const [pageError, setPageError] = useState('');
  const [planningError, setPlanningError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);

  // Values read synchronously inside async handlers (React state would be stale there).
  const s = useRef({
    account: DEFAULT_ACCOUNT, busy: false, revision: 0, planToken: 0, appliedShock: null, planning: {},
    amounts: {}, duration: null, incomePct: null, overlap: false, recent: [],
  }).current;
  const nextId = useRef(0);

  const setBusy = on => { s.busy = on; setBusyState(on); };
  const resetClarifications = () => { s.amounts = {}; s.duration = null; s.incomePct = null; s.overlap = false; };

  const addMessage = msg => setMessages(m => [...m, { id: ++nextId.current, ...msg }]);
  const say = (text, extra = {}) => addMessage({ kind: 'text', text, ...extra });
  const markDone = id => setMessages(m => m.map(x => (x.id === id ? { ...x, done: true } : x)));
  const interpretation = result => addMessage({ kind: 'interp', result, revision: s.revision, done: false });

  function showPlan(p) {
    const token = ++s.planToken;
    setPlan(p);
    setPlanVersion(v => v + 1);
    setExplanation({ loading: true });
    api('/api/explain', p)
      .then(t => { if (token === s.planToken) setExplanation({ data: t }); })
      .catch(e => { if (token === s.planToken) setExplanation({ error: e.message }); });
  }

  const loadAccount = useCallback(async id => {
    setBusy(true);
    setPageError('');
    try {
      const b = await api(`/api/accounts/${id}/baseline`);
      s.account = id;
      s.recent = readRecent(id);
      s.appliedShock = null;
      s.planning = {};
      s.revision++;
      s.planToken++;
      resetClarifications();
      setAccount(id);
      setRecentQueries(s.recent);
      setBaseline(b);
      setPlan(null);
      setPlanning({});
      setExplanation(null);
      setPlanningError('');
      setMessages([{ id: ++nextId.current, kind: 'text', text: GREETING }]);
    } catch (e) {
      setPageError(e.message);
    } finally {
      setBusy(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const h = await api('/api/health');
        setHealth(h.gemini_enabled ? 'Gemini configured · local data' : 'Manual mode · Gemini disabled');
        const ids = await api('/api/accounts');
        setAccountIds(ids.account_ids);
      } catch {
        setHealth('Connection unavailable');
      }
      await loadAccount(DEFAULT_ACCOUNT);
    })();
  }, [loadAccount]);

  function rememberQuery(text) {
    s.recent = [text, ...s.recent].slice(0, 2);
    try { sessionStorage.setItem(recentKey(s.account), JSON.stringify(s.recent)); } catch { /* storage unavailable */ }
    setRecentQueries(s.recent);
  }

  // morphFrom: the text box's on-screen rectangle, so the sent message can animate out of it.
  async function sendQuery(text, morphFrom) {
    if (s.busy) return;
    s.revision++;
    rememberQuery(text);
    say(text, { user: true, morphFrom });
    resetClarifications();
    setBusy(true);
    try {
      const r = await api('/api/parse-shock', { account_id: s.account, text });
      if (['ok', 'needs_input'].includes(r.status)) interpretation(r);
      else {
        say(r.message || 'No usable change was found. Try a more specific scenario.');
        if (r.status === 'error') setManualOpen(true);
      }
    } catch (e) {
      say(e.message);
    } finally {
      setBusy(false);
    }
  }

  function submitManual(f) {
    if (s.busy) return;
    const duration = Number(f.get('duration'));
    const change = Number(f.get('recurring'));
    const oneoff = Number(f.get('oneoff'));
    s.revision++;
    say('Manual scenario entered. Please review the amounts before applying.', { user: true });
    interpretation({
      status: 'ok',
      interpretation: 'All changes are held constant during the selected assessment window.',
      assumptions: change ? ['Recurring amount is a user-supplied change, already net of the existing category cost.'] : [],
      shock: {
        income_multiplier: Number(f.get('income')) / 100,
        income_duration_months: duration,
        scenario_duration_months: duration,
        household_bills_pct_change: Number(f.get('bills')),
        one_off_costs: oneoff ? [{ label: 'Immediate expense', amount_dollars: oneoff }] : [],
        recurring_costs: change ? [{ label: f.get('label'), monthly_change: change, source: 'user_estimate' }] : [],
      },
    });
  }

  async function clarify(msg, fd) {
    if (s.busy) return;
    if (msg.revision !== s.revision) { say(REPLACED); return; }
    for (const [k, v] of fd) {
      if (k.startsWith('amount_')) s.amounts[k.slice(7)] = Number(v);
      if (k === 'duration') s.duration = Number(v);
      if (k === 'incomePct') s.incomePct = Number(v);
      if (k === 'overlap') s.overlap = true;
    }
    setBusy(true);
    try {
      const r = await api('/api/resolve-shock', {
        account_id: s.account, draft: msg.result.draft, category_amounts: s.amounts, duration_months: s.duration,
        income_replacement_pct: s.incomePct, overlap_acknowledged: s.overlap,
      });
      markDone(msg.id);
      interpretation(r);
    } catch (e) {
      say(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyScenario(msg) {
    if (s.busy) return;
    if (msg.revision !== s.revision) { say(REPLACED); return; }
    const shock = msg.result.shock;
    const choices = {
      target_months: s.planning.target_months ?? 3,
      deadline_months: s.planning.deadline_months ?? 12,
      monthly_contribution: s.planning.monthly_contribution ?? null,
    };
    setBusy(true);
    try {
      const p = await api('/api/plan', { account_id: s.account, shock, planning: choices });
      s.planning = choices;
      s.appliedShock = shock;
      setPlanning(choices);
      showPlan(p);
      markDone(msg.id);
      say('Scenario applied. The comparison and funding plan are ready.');
    } catch (e) {
      say(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function recalculatePlan(settings) {
    if (s.busy || !s.appliedShock) return;
    setPlanningError('');
    setBusy(true);
    try {
      const p = await api('/api/plan', { account_id: s.account, shock: s.appliedShock, planning: settings });
      s.planning = settings;
      setPlanning(settings);
      showPlan(p);
    } catch (e) {
      setPlanningError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return {
    health, accountIds, account, baseline, plan, planVersion, planning, explanation, messages, recentQueries,
    busy, pageError, planningError, manualOpen, setManualOpen,
    loadAccount, sendQuery, submitManual, clarify, applyScenario, recalculatePlan,
  };
}
