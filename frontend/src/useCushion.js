import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './format.js';

const GREETING = 'What would you like to stress-test? I’ll ask for an estimate if the account data doesn’t identify a cost.';
const REPLACED = 'This interpretation has been replaced. Use the latest scenario.';
const DEFAULT_ACCOUNT = 20134;
const STACKED = 'Builds on your applied scenario: these changes are added to the ones already applied, and each keeps its own duration.';
export const MAX_STACKED = 10;  // matches ShockModel.parts max_length in the API

// Stack a new shock on top of the one already applied, so scenarios are cumulative. Each shock stays a
// separate part with its own duration; the engine applies each part only during its own window.
export function combineShocks(prev, next) {
  return { shock: { parts: [...shockParts(prev), ...shockParts(next)] }, notes: [STACKED] };
}

// A shock as a flat list of parts (a scenario with several timelines already arrives as parts).
export const shockParts = shock => (shock.parts?.length ? shock.parts : [shock]);

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
  const [basePlan, setBasePlan] = useState(null);   // no-scenario plan, so the Plan tab works before a stress test
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
    amounts: {}, duration: null, durations: {}, incomePct: null, overlap: false, recent: [],
  }).current;
  const nextId = useRef(0);

  const setBusy = on => { s.busy = on; setBusyState(on); };
  const resetClarifications = () => { s.amounts = {}; s.duration = null; s.durations = {}; s.incomePct = null; s.overlap = false; };

  const addMessage = msg => setMessages(m => [...m, { id: ++nextId.current, ...msg }]);
  const say = (text, extra = {}) => addMessage({ kind: 'text', text, ...extra });
  const markDone = id => setMessages(m => m.map(x => (x.id === id ? { ...x, done: true } : x)));
  // A reviewable scenario is shown (and applied) on top of whatever is already applied.
  const interpretation = result => {
    if (result.status === 'ok' && result.shock && s.appliedShock) {
      if (shockParts(s.appliedShock).length + shockParts(result.shock).length > MAX_STACKED) {
        say(`You can stack up to ${MAX_STACKED} changes. Load the account again to start a new scenario.`);
        return;
      }
      const { shock, notes } = combineShocks(s.appliedShock, result.shock);
      result = { ...result, shock, added: result.shock, assumptions: [...(result.assumptions || []), ...notes] };
    }
    addMessage({ kind: 'interp', result, revision: s.revision, done: false });
  };

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
      setBasePlan(null);
      setPlanning({});
      setExplanation(null);
      setPlanningError('');
      setMessages([{ id: ++nextId.current, kind: 'text', text: GREETING }]);
    } catch (e) {
      setPageError(e.message);
      return;
    } finally {
      setBusy(false);
    }
    // Goal plan with no shock applied; failure just leaves the Plan tab's empty state.
    api('/api/plan', { account_id: id, shock: {} })
      .then(p => { if (s.account === id && !s.appliedShock) { setBasePlan(p); setPlanVersion(v => v + 1); } })
      .catch(() => {});
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
      if (k.startsWith('duration_')) s.durations[k.slice(9)] = Number(v);
      if (k === 'incomePct') s.incomePct = Number(v);
      if (k === 'overlap') s.overlap = true;
    }
    setBusy(true);
    try {
      const r = await api('/api/resolve-shock', {
        account_id: s.account, draft: msg.result.draft, category_amounts: s.amounts, duration_months: s.duration,
        income_replacement_pct: s.incomePct, overlap_acknowledged: s.overlap, durations: s.durations,
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
    if (s.busy) return;
    setPlanningError('');
    setBusy(true);
    try {
      // Without an applied scenario only the goal plan is shown, so plan against no shock.
      const p = await api('/api/plan', { account_id: s.account, shock: s.appliedShock ?? {}, planning: settings });
      s.planning = settings;
      setPlanning(settings);
      if (s.appliedShock) showPlan(p);
      else { setBasePlan(p); setPlanVersion(v => v + 1); }
    } catch (e) {
      setPlanningError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return {
    health, accountIds, account, baseline, plan, basePlan, planVersion, planning, explanation, messages, recentQueries,
    busy, pageError, planningError, manualOpen, setManualOpen,
    loadAccount, sendQuery, submitManual, clarify, applyScenario, recalculatePlan,
  };
}
