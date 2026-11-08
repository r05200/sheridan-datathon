export default function PlanContext({ plan }) {
  const context = plan?.account_context;
  if (!context) return null;
  const observations = context.historical_observations || [];

  return (
    <section className="plan-context" aria-labelledby="plan-context-title">
      <h3 id="plan-context-title">What the account history adds</h3>
      {observations.length ? (
        <ul>{observations.map(item => <li key={item}>{item}</li>)}</ul>
      ) : <p>The account history does not show any additional warning signs.</p>}
      <small>Past activity is included for context only. It does not change the calculation or predict what will happen next.</small>
    </section>
  );
}
