import { useEffect, useState } from 'react';
import { api, cash } from '../format.js';

const STAT_CARDS = [
  ['spending_exceeds_income', 'Spend more than they receive each month'],
  ['under_twelve_months', 'Savings may run out within 12 months if spending exceeds income'],
  ['under_six_months', 'Savings may run out within 6 months if spending exceeds income'],
  ['can_cover_six_months_at_zero_income', 'Could cover 6 months of spending without income'],
];

function ScenarioCard({ title, result, total }) {
  const count = result.under_six_months;
  const width = Math.min(100, count / total * 100);
  const difference = result.additional_under_six_vs_baseline;
  return (
    <article className="portfolio-scenario">
      <div className="portfolio-scenario-heading">
        <strong>{title}</strong>
        <b>{count.toLocaleString()}</b>
      </div>
      <div className="portfolio-track" role="img" aria-label={`${count.toLocaleString()} of ${total.toLocaleString()} accounts with less than 6 months of savings`}>
        <span style={{ width: `${width}%` }} />
      </div>
      <small>
        {Math.abs(difference).toLocaleString()} {difference < 0 ? 'fewer' : 'more'} accounts have less than 6 months of savings than under usual conditions
      </small>
      {result.additional_under_six_vs_55_percent_income != null && (
        <small>
          {Math.abs(result.additional_under_six_vs_55_percent_income).toLocaleString()} {result.additional_under_six_vs_55_percent_income < 0 ? 'fewer' : 'more'} than when income falls on its own
        </small>
      )}
      {result.buffers_depleted_after_scenario > 0 && (
        <small>{result.buffers_depleted_after_scenario.toLocaleString()} accounts have no savings left</small>
      )}
    </article>
  );
}

export default function PortfolioSummary() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/tangerine/portfolio')
      .then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  if (error) return <p className="notice error" role="alert">We could not load the portfolio overview. {error}</p>;
  if (!data) return <p className="portfolio-loading" aria-live="polite">Loading the portfolio overview...</p>;

  const scenarios = data.scenarios;
  const scenarioItems = [
    ['Income falls to 55% of usual', scenarios.income_at_55_percent],
    ['Income falls to 55%, bills rise 15%', scenarios.income_at_55_percent_and_bills_up_15_percent],
    ['One-time cost equal to a month of spending', scenarios.one_month_spending_repair],
  ];

  return (
    <section className="portfolio-summary" aria-labelledby="portfolio-title">
      <div className="portfolio-heading">
        <div>
          <p className="eyebrow">ALL {data.total_accounts.toLocaleString()} ACCOUNTS</p>
          <h2 id="portfolio-title">What could happen if things changed?</h2>
        </div>
        <span>Account history through {data.as_of}</span>
      </div>
      <div className="portfolio-baseline">
        {STAT_CARDS.map(([key, label]) => (
          <article key={key}>
            <strong>{data.baseline[key].toLocaleString()}</strong>
            <small>{label}</small>
          </article>
        ))}
      </div>
      <div className="portfolio-scenarios">
        {scenarioItems.map(([title, result]) => <ScenarioCard key={title} title={title} result={result} total={data.total_accounts} />)}
      </div>
    </section>
  );
}
