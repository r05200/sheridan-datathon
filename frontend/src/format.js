// API access and the display formatting shared by every component.

export async function api(path, body) {
  const init = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const r = await fetch(path, init);
  let j;
  try { j = await r.json(); } catch { throw Error('Server returned an unreadable response.'); }
  if (!r.ok) throw Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail || j));
  return j;
}

const wholeDollars = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });

export const cash = x => (x == null ? 'Not available' : wholeDollars.format(x));
export const preciseCash = n => (n == null ? 'Not available' : cents.format(n));

export function runway(obj) {
  if (obj.runway_months === 'no_shortfall') return 'No shortfall';
  return `${obj.runway_capped ? '≥ ' : ''}${obj.runway_months} months`;
}

// Baseline runway computed in the browser when no plan has been calculated yet.
export function baselineRunway(b) {
  const gap = b.spending - b.income;
  return {
    income: b.income,
    spending: b.spending,
    buffer: b.buffer,
    runway_months: b.buffer <= 0 ? 0 : gap <= 0 ? 'no_shortfall' : Math.min(b.buffer / gap, 120).toFixed(1),
    runway_capped: gap > 0 && b.buffer / gap > 120,
  };
}

// Plain-language bullet list of what a scenario changes, shown before it is applied.
export function describeChanges(s) {
  const out = [];
  const months = n => `${n} month${n === 1 ? '' : 's'}`;
  if (s.parts?.length) {
    // Stacked scenario: each part keeps its own duration.
    let longest = 0;
    for (const p of s.parts) {
      const window = p.scenario_duration_months || p.income_duration_months;
      longest = Math.max(longest, window || 0);
      for (const line of describeChanges(p)) {
        if (line.startsWith('Assessed over') || line === 'No changes from your baseline') continue;
        const timed = /^(No income|Income) /.test(line) || line.endsWith(' one-off');
        out.push(window && !timed ? `${line} for ${months(window)}` : line);
      }
    }
    if (!out.length) out.push('No changes from your baseline');
    if (longest) out.push(`Assessed over ${months(longest)}; each change lasts only for its own duration`);
    return out;
  }
  if (s.income_multiplier != null && s.income_multiplier !== 1) {
    const pct = Math.round(s.income_multiplier * 1000) / 10;
    out.push(pct === 0
      ? `No income for ${months(s.income_duration_months)}`
      : `Income ${pct < 100 ? 'drops' : 'rises'} to ${pct}% of normal for ${months(s.income_duration_months)}`);
  }
  if (s.household_bills_pct_change) {
    out.push(`Household bills ${s.household_bills_pct_change > 0 ? 'rise' : 'fall'} ${Math.abs(s.household_bills_pct_change)}%`);
  }
  for (const c of s.one_off_costs || []) out.push(`${c.label}: ${preciseCash(c.amount_dollars)} one-off`);
  for (const c of s.recurring_costs || []) {
    out.push(`${c.label}: ${c.monthly_change > 0 ? '+' : '−'}${preciseCash(Math.abs(c.monthly_change))}/month`);
  }
  if (!out.length) out.push('No changes from your baseline');
  if (s.scenario_duration_months) out.push(`Assessed over ${months(s.scenario_duration_months)}`);
  return out;
}
