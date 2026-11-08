import { useLayoutEffect, useRef, useState } from 'react';
import Interpretation from './Interpretation.jsx';

// Animate a sent message out of the composer: it starts at the text box's position and size,
// then settles into the chat as a bar.
function morph(el, from) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  el.animate([
    { transformOrigin: 'top left', opacity: 0.6,
      transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width},${from.height / to.height})` },
    { transformOrigin: 'top left', transform: 'none', opacity: 1 },
  ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

function ManualForm({ busy, onSubmit }) {
  return (
    <form id="manual-form" onSubmit={e => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); }}>
      <div className="form-grid">
        <label>Income retained (%)<input name="income" type="number" min="0" max="150" defaultValue="100" step="0.1" required /></label>
        <label>Household bills change (%)<input name="bills" type="number" min="-50" max="200" defaultValue="0" step="0.1" required /></label>
        <label>One-off expense ($)<input name="oneoff" type="number" min="0" max="1000000" defaultValue="0" step="0.01" required /></label>
        <label>Assessment duration (months)<input name="duration" type="number" min="1" max="60" defaultValue="6" required /></label>
        <label>Recurring adjustment ($/month)<input name="recurring" type="number" min="-1000000" max="1000000" defaultValue="0" step="0.01" required /></label>
        <label>Adjustment label<input name="label" defaultValue="User-supplied expense" maxLength="100" required /></label>
      </div>
      <small>Enter only the change in recurring spending, not the existing category budget. All changes are held constant over this duration.</small>
      <button type="submit" disabled={busy}>Review manual scenario</button>
    </form>
  );
}

export default function ChatPanel({ c }) {
  const [query, setQuery] = useState('');
  const listRef = useRef(null);
  const queryRef = useRef(null);

  // Keep the newest message in view; a just-sent message animates out of the text box.
  useLayoutEffect(() => {
    const list = listRef.current;
    const last = c.messages.at(-1);
    if (!list || !last) return;
    if (last.morphFrom) {
      list.scrollTop = list.scrollHeight;
      morph(list.lastElementChild, last.morphFrom);
    } else {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
  }, [c.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function send(e) {
    e.preventDefault();
    const text = query.trim();
    if (c.busy || !c.baseline || !text) return;
    const r = queryRef.current.getBoundingClientRect();
    setQuery('');
    c.sendQuery(text, { left: r.left, top: r.top, width: r.width, height: r.height });
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form.requestSubmit();
    }
  }

  function reuse(q) {
    if (c.busy) return;
    setQuery(q);
    queryRef.current.focus();
  }

  return (
    <section className="chat-panel">
      <div className="panel-heading">
        <div>
          <h2>Describe a change</h2>
          <p>Plain language in. Clear assumptions out.</p>
        </div>
      </div>
      <div id="messages" className="messages" aria-live="polite" ref={listRef}>
        {c.messages.map(m => (m.kind === 'interp'
          ? <Interpretation key={m.id} msg={m} busy={c.busy} onClarify={c.clarify} onApply={c.applyScenario} />
          : <div key={m.id} className={'message' + (m.user ? ' user' : '')}>{m.text}</div>))}
      </div>
      <div className="examples" id="recent-queries" aria-label="Recent queries" hidden={!c.recentQueries.length}>
        {c.recentQueries.map(q => (
          <button key={q} type="button" title={q} aria-label={'Reuse query: ' + q} disabled={c.busy} onClick={() => reuse(q)}>
            <span className="recent-query-text">{q}</span><span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <form id="chat-form" onSubmit={send}>
        <label className="sr-only" htmlFor="query">Describe your financial shock</label>
        <textarea id="query" ref={queryRef} maxLength="500" rows="3" required disabled={c.busy}
          placeholder="What if groceries rise 10%, or I lose my income for six months?"
          value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} />
        <div className="composer-footer">
          <small>Estimates stay labelled. You review before applying.</small>
          <button id="send" type="submit" disabled={c.busy}>{c.busy ? 'Working…' : 'Interpret ↗'}</button>
        </div>
      </form>
      <details className="manual" open={c.manualOpen} onToggle={e => c.setManualOpen(e.currentTarget.open)}>
        <summary>Use manual scenario controls</summary>
        <ManualForm busy={c.busy} onSubmit={c.submitManual} />
      </details>
    </section>
  );
}
