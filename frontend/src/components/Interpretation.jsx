import { describeChanges } from '../format.js';

function Question({ q }) {
  switch (q.kind) {
    case 'monthly_cost':
      return <label>{q.question}<input type="number" name={`amount_${q.key}`} min="0" max="1000000" step="0.01" required placeholder="Monthly amount in CAD" /></label>;
    case 'income_percentage':
      return <label>{q.question}<input type="number" name="incomePct" min="0" max="150" step="0.1" required placeholder="0 for no income, 55 for 55%" /></label>;
    case 'duration':
      return <label>{q.question}<input type="number" name="duration" min="1" max="60" step="1" required /></label>;
    case 'confirmation':
      return <label className="check"><input type="checkbox" name="overlap" required /> {q.question}</label>;
    default:
      return <p className="error">Please revise your message: {q.question}</p>;
  }
}

// The assistant's reading of a scenario: either questions to answer, or a summary to review and apply.
export default function Interpretation({ msg, busy, onClarify, onApply }) {
  const r = msg.result;
  const needsInput = r.status === 'needs_input';
  const rephrase = needsInput && r.questions.some(q => q.kind === 'rephrase');

  return (
    <div className="message">
      <p><strong>{needsInput ? 'A little more detail' : 'Review your scenario'}</strong></p>
      <p>{r.interpretation || 'Please review the changes and assumptions below.'}</p>
      {r.status === 'ok' && r.shock && (
        <ul className="changes">{describeChanges(r.shock).map(x => <li key={x}>{x}</li>)}</ul>
      )}
      {r.assumptions?.length > 0 && <ul>{r.assumptions.map(a => <li key={a}>{a}</li>)}</ul>}
      {needsInput ? (
        <form className="clarify" onSubmit={e => { e.preventDefault(); onClarify(msg, new FormData(e.currentTarget)); }}>
          {r.questions.map((q, i) => <Question key={q.key ?? i} q={q} />)}
          {!rephrase && !msg.done && <button type="submit" disabled={busy}>Use these values →</button>}
        </form>
      ) : (
        <>
          <details><summary>See exact scenario inputs</summary><pre>{JSON.stringify(r.shock, null, 2)}</pre></details>
          {!msg.done && <button type="button" disabled={busy} onClick={() => onApply(msg)}>Apply this scenario ↗</button>}
        </>
      )}
    </div>
  );
}
