const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash = x => x == null ? '—' : new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(x);
const state = {account:20134, baseline:null, plan:null, pending:null, amounts:{}, duration:null, incomePct:null, overlap:false, busy:false, revision:0, recentQueries:[], appliedShock:null, planning:{}};
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let j;try{j=await r.json()}catch{throw Error('Server returned an unreadable response.')}if(!r.ok)throw Error(typeof j.detail==='string'?j.detail:JSON.stringify(j.detail||j));return j;}
function busy(on){state.busy=on;document.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=on);$('#send').textContent=on?'Working…':'Interpret ↗';}
function renderRecentQueries(){
 const container=$('#recent-queries');
 container.replaceChildren();
 container.hidden=state.recentQueries.length===0;
 for(const query of state.recentQueries){
  const button=document.createElement('button');
  button.type='button';button.title=query;button.disabled=state.busy;
  button.setAttribute('aria-label','Reuse query: '+query);
  const label=document.createElement('span');label.className='recent-query-text';label.textContent=query;
  const arrow=document.createElement('span');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
  button.append(label,arrow);
  button.onclick=()=>{if(state.busy)return;$('#query').value=query;$('#query').focus();};
  container.append(button);
 }
}
function loadRecentQueries(){
 try{const saved=JSON.parse(sessionStorage.getItem('runway:recentQueries:'+state.account)||'[]');
  state.recentQueries=Array.isArray(saved)?saved.filter(q=>typeof q==='string'&&q.trim()&&q.length<=500).slice(0,2):[];
 }catch{state.recentQueries=[];}
 renderRecentQueries();
}
function rememberQuery(query){
 state.recentQueries=[query,...state.recentQueries].slice(0,2);
 try{sessionStorage.setItem('runway:recentQueries:'+state.account,JSON.stringify(state.recentQueries));}catch{}
 renderRecentQueries();
}
function message(text,user=false){const el=document.createElement('div');el.className='message'+(user?' user':'');el.textContent=text;$('#messages').append(el);el.scrollIntoView({block:'nearest',behavior:'smooth'});return el;}
function runway(obj){if(obj.runway_months==='no_shortfall')return 'No shortfall';return `${obj.runway_capped?'≥ ':''}${obj.runway_months} months`;}
function renderBaseline(){const b=state.baseline,p=state.plan;const base=p?.baseline||{income:b.income,spending:b.spending,buffer:b.buffer,runway_months:b.buffer<=0?0:b.spending<=b.income?'no_shortfall':Math.min(b.buffer/(b.spending-b.income),120).toFixed(1),runway_capped:b.spending>b.income&&b.buffer/(b.spending-b.income)>120};const cards=[['Monthly inflows',cash(b.income),'Median recorded money in'],['Monthly spending',cash(b.spending),'Median recorded money out'],['Household bills',cash(b.household_bills),'Recorded category, not rent alone'],['Fixed costs',cash(b.fixed_costs),'Median of monthly bills + insurance + loans'],['Savings buffer',cash(b.buffer),'Mean balance over last six months'],['Baseline runway',runway(base),base.runway_capped?'Capped at 120 months':'Under typical conditions']];$('#metrics').innerHTML=cards.map((c,i)=>`<div class="metric ${i===4?'highlight':''}"><label>${c[0]}</label><strong>${c[1]}</strong><small>${c[2]}</small></div>`).join('');$('#account-meta').textContent=`${b.months_of_history} observed months · Active loan payment ${cash(b.loan_payment)}/month`;renderStressInsights(b);}
function renderHistoryCharts(series){
 if(!series?.length)return '';
 const width=720,height=220,left=52,right=12,top=18,bottom=38,plotWidth=width-left-right,plotHeight=height-top-bottom;
 const maxFlow=Math.max(1,...series.flatMap(item=>[item.money_in,item.money_out]))*1.08;
 const flowY=value=>top+plotHeight-(value/maxFlow)*plotHeight;
 const step=plotWidth/series.length,barWidth=Math.min(13,step*.3);
 const flowBars=series.map((item,index)=>{
  const center=left+step*(index+.5),inY=flowY(item.money_in),outY=flowY(item.money_out);
  return `<rect class="flow-in" x="${center-barWidth-1}" y="${inY}" width="${barWidth}" height="${top+plotHeight-inY}" rx="2"><title>${esc(item.month)} inflow: ${cash(item.money_in)}</title></rect><rect class="flow-out" x="${center+1}" y="${outY}" width="${barWidth}" height="${top+plotHeight-outY}" rx="2"><title>${esc(item.month)} outflow: ${cash(item.money_out)}</title></rect>`;
 }).join('');
 const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const monthLabels=series.map((item,index)=>index%2===0?`<text class="chart-label" x="${left+step*(index+.5)}" y="${height-12}" text-anchor="middle">${monthNames[Number(item.month.slice(5))-1]||esc(item.month)}</text>`:'').join('');
 const minBalance=Math.min(0,...series.map(item=>item.month_end_balance)),maxBalance=Math.max(0,...series.map(item=>item.month_end_balance));
 const balancePad=Math.max((maxBalance-minBalance)*.08,1),balanceMin=minBalance-balancePad,balanceMax=maxBalance+balancePad;
 const balanceY=value=>top+plotHeight-((value-balanceMin)/(balanceMax-balanceMin))*plotHeight;
 const balancePoints=series.map((item,index)=>`${left+step*(index+.5)},${balanceY(item.month_end_balance)}`).join(' ');
 const zeroY=balanceY(0);
 const compact=value=>value===0?'$0':`${value<0?'−':''}$${Math.round(Math.abs(value)/1000)}k`;
 return `<div class="history-visuals">
  <article class="history-chart"><div class="chart-heading"><h3>Money in and out each month</h3><span>Last ${series.length} recorded months</span></div>
   <div class="chart-legend"><span><i class="legend-in"></i>Money in</span><span><i class="legend-out"></i>Money out</span></div>
   <svg class="account-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly money in and money out for the last ${series.length} recorded months">
    <line class="chart-gridline" x1="${left}" y1="${top}" x2="${width-right}" y2="${top}"/><line class="chart-axis" x1="${left}" y1="${top+plotHeight}" x2="${width-right}" y2="${top+plotHeight}"/>
    <text class="chart-label" x="${left-8}" y="${top+4}" text-anchor="end">${cash(maxFlow/1.08)}</text>${flowBars}${monthLabels}
   </svg>
   <p class="chart-caption">Bars compare recorded inflows and outflows; they do not categorize spending.</p>
  </article>
  <article class="history-chart"><div class="chart-heading"><h3>Month-end balance</h3><span>Recorded balance over time</span></div>
   <div class="chart-legend"><span><i class="legend-balance"></i>Balance</span><span><i class="legend-zero"></i>$0 line</span></div>
   <svg class="account-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Month-end balance for the last ${series.length} recorded months; the dashed line marks zero">
    <line class="chart-gridline" x1="${left}" y1="${top}" x2="${width-right}" y2="${top}"/><line class="chart-zero" x1="${left}" y1="${zeroY}" x2="${width-right}" y2="${zeroY}"/>
    <text class="chart-label" x="${left-8}" y="${top+4}" text-anchor="end">${compact(maxBalance)}</text><text class="chart-label" x="${left-8}" y="${top+plotHeight}" text-anchor="end">${compact(minBalance)}</text>
    <polyline class="balance-line" points="${balancePoints}"/>${series.map((item,index)=>`<circle class="balance-point" cx="${left+step*(index+.5)}" cy="${balanceY(item.month_end_balance)}" r="3"><title>${esc(item.month)} month-end balance: ${cash(item.month_end_balance)}</title></circle>`).join('')}${monthLabels}
   </svg>
   <p class="chart-caption">A month-end value is a snapshot; it does not show every balance change during the month.</p>
  </article>
 </div>`;
}
function renderStressInsights(b){
 const s=b.stress;
 if(!s){$('#stress-insights').replaceChildren();return;}
 const peer=b.peer_context,pension=b.pension_check,w=b.watchlist,v=w.validation;
 const share=s.cash_withdrawal_share==null?'—':`${(s.cash_withdrawal_share*100).toFixed(1)}%`;
 const shareValue=Math.max(0,Math.min(100,(s.cash_withdrawal_share||0)*100));
 const negativeRate=s.observations?100*s.negative_month_count/s.observations:0;
 const peerPercentile=Math.max(0,Math.min(100,peer.runway_percentile));
 const runwayText=(status,months)=>status==='no_shortfall'?'No monthly shortfall':`${months} months`;
 const balanceChange=Math.abs(s.balance_trend.recent_vs_prior_3_month_mean_change);
 const balanceDirection=s.balance_trend.falling?'lower':balanceChange===0?'the same':'higher';
 const rankPosition=w.eligible_accounts?100*(w.rank-.5)/w.eligible_accounts:0;
 const summary=s.negative_month_count>0
  ?`${s.negative_month_count} months in the recorded history had at least one day below $0.`
  :'No day below $0 appears in the recorded history.';
 const html=`<section class="stress-block" aria-labelledby="stress-title">
  <div class="stress-heading">
   <div><p class="eyebrow">A closer look at the history</p><h2 id="stress-title">What the account history shows</h2><p>${summary} These are historical signals, not a prediction.</p></div>
  </div>
  <div class="stress-grid">
   <article class="stress-stat ${s.negative_month_count?'warning':''}"><small>Months with a day below $0</small><strong>${s.negative_month_count} <span>of ${s.observations}</span></strong><progress class="signal-progress negative-progress" max="100" value="${negativeRate}" aria-label="${negativeRate.toFixed(1)} percent of observed months had a day below zero"></progress><p>A month is counted if the balance went below zero on any day.</p></article>
   <article class="stress-stat ${s.worst_observed_balance<0?'warning':''}"><small>Lowest recorded balance</small><strong>${cash(s.worst_observed_balance)}</strong><p>Lowest point seen in the available history.</p></article>
   <article class="stress-stat"><small>Cash withdrawals</small><strong>${share}</strong><progress class="signal-progress cash-progress" max="100" value="${shareValue}" aria-label="${share} of recorded money out was cash withdrawals"></progress><p>Share of recorded money out. Withdrawals are not assumed to be optional spending.</p></article>
   <article class="stress-stat"><small>Loan payments</small><div class="stress-pair"><span><strong>${cash(s.loan_contract_monthly_payment)}</strong><small>Scheduled amount</small></span><span><strong>${cash(s.median_observed_loan_payment)}</strong><small>Typical recorded month</small></span></div><p>${esc(s.loan_status_meaning)}. Recorded payments can be zero in months without a payment.</p></article>
  </div>
  ${renderHistoryCharts(s.monthly_history)}
  <div class="insight-panels">
   <article class="insight-panel ${s.income_trend.median_overstates_recent?'warning':''}">
    <h3>Is income lower recently?</h3>
    <p>Last 3 months: <strong>${cash(s.income_trend.recent_3_month_median)}</strong> per month</p>
    <p>Full-history typical: <strong>${cash(s.income_trend.official_full_history_median)}</strong> per month</p>
    <p class="insight-takeaway">${s.income_trend.median_overstates_recent?'Recent income is at least 20% below the full-history median.':'No recent-income drop of 20% or more.'}</p>
   </article>
   <article class="insight-panel ${s.balance_trend.falling?'warning':''}">
    <h3>Is the balance falling?</h3>
    <p>Recent three-month average balance is <strong>${cash(balanceChange)}</strong> ${balanceDirection} than the previous three-month average.</p>
    <p class="insight-takeaway">${s.balance_trend.falling?'The recent balance trend is downward.':'No downward trend in this comparison.'}</p>
   </article>
   <article class="insight-panel">
    <h3>Compared with similar accounts</h3>
    <p>${esc(peer.income_band)} · ${peer.pension_majority?'mostly pension income':'not mostly pension income'} · ${peer.peer_count.toLocaleString()} accounts.</p>
    <p>This account’s official runway is longer than about <strong>${peer.runway_percentile}%</strong> of this group. ${peer.peer_capped_share}% of the group is shown at the 120-month cap.</p>
    <progress class="signal-progress peer-progress" max="100" value="${peerPercentile}" aria-label="Runway percentile ${peer.runway_percentile} percent within the peer group"></progress><div class="progress-labels"><span>Shorter runway</span><span>Longer runway</span></div>
   </article>
   <article class="insight-panel">
    <h3>Watchlist (never-negative accounts only)</h3>
    <p>${w.eligible?`Relative band: <strong>${esc(w.band)}</strong> · position ${w.rank.toLocaleString()} of ${w.eligible_accounts.toLocaleString()}.`:'Not ranked: this account has a recorded month with a day below $0.'}</p>
    ${w.eligible?`<div class="watchlist-scale" role="img" aria-label="Watchlist position ${w.rank} of ${w.eligible_accounts}; lower rank is higher priority"><span class="watch-priority"></span><span class="watch-watch"></span><span class="watch-routine"></span><i style="--rank-position:${rankPosition}%"></i></div><div class="progress-labels"><span>Higher priority</span><span>Lower priority</span></div>`:''}
    <p>This is a sorting aid, not a chance or probability.</p>
    <details class="validation-detail"><summary>How did this sorting rule do in a past six-month check?</summary><p>Of ${v.priority_band_size} flagged accounts (the top 5%), ${v.priority_band_events} later went below $0: ${(v.priority_band_hit_rate*100).toFixed(1)}% of flagged accounts. The list included ${v.priority_band_events} of ${v.later_event_accounts} later events (${(v.later_events_captured_pct*100).toFixed(1)}%). Lowest recent surplus alone found ${v.lowest_surplus_same_size_events} events in a list of the same size. This is one historical check, not a forecast.</p></details>
   </article>
  </div>
  ${pension?`<article class="insight-panel pension-note"><h3>Pension income comparison</h3><p>Official runway: <strong>${runwayText(pension.official_baseline_runway_status,pension.official_baseline_runway_months)}</strong>. EI-at-55% comparison: <strong>${runwayText(pension.ei55_runway_status,pension.ei55_runway_months)}</strong>.</p><p>Employment Insurance does not apply to pension income. The EI figure is an illustrative comparison only.</p></article>`:''}
  <details class="data-source-note"><summary>About these numbers and data limits</summary><p>${esc(s.data_note)} The source is relabelled PKDD'99 Berka history; districts are Czech, groceries are not a recorded field, and category budgets or one-off prices are user-supplied.</p></details>
 </section>`;
 $('#stress-insights').innerHTML=html;
}
function renderResults(){const p=state.plan,b=state.baseline;if(!p){$('#results').innerHTML='<div class="empty"><div class="empty-icon">↗</div><h3>One change can tell a bigger story.</h3><p>Describe a scenario to compare your starting point<br>with what happens next.</p></div>'+`<details class="data"><summary>Explore the full account baseline</summary><pre>${esc(JSON.stringify(b,null,2))}</pre></details>`;return;}
const a=p.after_shock;const rows=[['Monthly inflows',cash(p.baseline.income),cash(a.income)],['Monthly spending',cash(p.baseline.spending),cash(a.spending)],['Buffer after immediate costs',cash(p.baseline.buffer),cash(a.buffer)],['Monthly shortfall',cash(Math.max(b.spending-b.income,0)),cash(a.monthly_gap)],['Runway',runway(p.baseline),runway(a)],['Immediate expense','—',cash(a.one_off_costs||0)]];
let html=`<table class="comparison"><thead><tr><th>Account ${state.account}</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table>`;
const d=p.duration_assessment;if(d){html+=`<div class="outcome ${d.covers_duration?'':'danger'}"><h3>${d.covers_duration?'Covered':'Funding gap'} over ${d.months} months</h3><p>${esc(d.assumption)}</p><div class="mini-grid"><div class="mini"><small>Required starting buffer</small><strong>${cash(d.required_starting_buffer)}</strong></div><div class="mini"><small>Additional buffer needed</small><strong>${cash(d.additional_buffer_needed)}</strong></div></div></div>`;html+=chart(p);}
html+=`<div class="mini-grid"><div class="mini"><small>Required monthly spending reduction</small><strong>${cash(p.backup_plan.monthly_cut_needed)}</strong></div><div class="mini"><small>Immediate funding needed</small><strong>${cash(p.backup_plan.upfront_funding_needed)}</strong></div><div class="mini"><small>Emergency-fund target</small><strong>${cash(p.goal_plan.target_amount)}</strong></div><div class="mini"><small>Time to goal at baseline surplus</small><strong>${p.goal_plan.months_to_goal===null?'Not reachable':p.goal_plan.months_to_goal+' months'}</strong></div></div>${renderActionPlan(p)}<div id="explanation" class="explanation"><p>Preparing the explanation…</p></div><details class="data"><summary>Inspect all calculated values and account data</summary><pre>${esc(JSON.stringify({account:b,plan:p},null,2))}</pre></details><p style="font-size:10px;color:var(--muted)">Amounts are displayed as whole dollars. Estimates are scenario inputs, not observed category budgets.</p>`;$('#results').innerHTML=html;bindPlanning();}
const preciseCash = n => n == null ? '—' : new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',minimumFractionDigits:2}).format(n);
function renderActionPlan(p){
 const a=p.action_plan;if(!a)return '';
 const g=a.goal,b=a.backup,settings=state.planning;
 const selected=settings.monthly_contribution??'';
 const goalStatus={target_met:'Target already met',no_surplus:'Restore cash flow first',no_contribution:'Choose a saving amount',saving:'Build your buffer'};
 const backupStatus={immediate_funding_gap:'Immediate funding still needed',covered:'Proposed budget covers the shock',funding_gap:'More changes are needed',stabilized:'Monthly cash flow is balanced',needs_duration:'Choose a horizon to check coverage'};
 return `<section class="action-plans" aria-labelledby="make-plan-title"><div class="section-title"><h2 id="make-plan-title">Make a plan</h2><span>Calculated from this account</span></div>
 <form id="planning-form"><article class="plan-card"><p class="eyebrow">BEFORE A SHOCK</p><h3>Your goal plan</h3><p class="plan-status">${esc(goalStatus[g.status])}</p>
 <div class="form-grid"><label>Emergency fund (months of normal spending)<input name="target_months" type="number" min="1" max="12" step="1" value="${g.target_months}" required></label><label>Goal deadline (months)<input name="deadline_months" type="number" min="1" max="120" step="1" value="${g.deadline_months}" required></label><label>Monthly saving contribution ($)<input name="monthly_contribution" type="number" min="0.01" max="1000000" step="0.01" value="${esc(selected)}" placeholder="Automatic: ${g.available_monthly_saving.toFixed(2)}"></label></div>
 <div class="goal-progress"><div style="width:${g.progress_pct}%"></div></div><small>${g.progress_pct}% of target covered by the current buffer</small>
 <dl class="plan-numbers"><div><dt>Target buffer</dt><dd>${preciseCash(g.target_amount)}</dd></div><div><dt>Still to build</dt><dd>${preciseCash(g.amount_still_needed)}</dd></div><div><dt>Available monthly surplus</dt><dd>${preciseCash(g.available_monthly_saving)}</dd></div><div><dt>Selected monthly saving</dt><dd>${preciseCash(g.monthly_contribution)}</dd></div><div><dt>Time at this saving pace</dt><dd>${g.months_to_goal===null?'Not reachable yet':g.months_to_goal===0?'Already funded':g.months_to_goal+' whole months'}</dd></div><div><dt>Saving needed for your deadline</dt><dd>${preciseCash(g.monthly_saving_for_deadline)}/month</dd></div></dl>
 <ol class="plan-steps">${g.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol><small>${esc(g.assumption)}</small></article>
 <article class="plan-card"><p class="eyebrow">IF THE SHOCK HITS</p><h3>Your backup plan</h3><p class="plan-status">${esc(backupStatus[b.status])}</p><p class="plan-help">Enter changes you can realistically make. These test a backup budget; they do not alter the original shock above.</p>
 <div class="form-grid"><label>Confirmed spending reduction ($/month)<input name="confirmed_monthly_cut" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_monthly_cut}" required></label><label>Confirmed extra income ($/month)<input name="confirmed_extra_income" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_extra_income}" required></label><label>Confirmed upfront funds ($)<input name="confirmed_upfront_funds" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_upfront_funds}" required></label></div>
 <dl class="plan-numbers"><div><dt>Immediate funding still needed</dt><dd>${preciseCash(b.remaining_immediate_funding_gap)}</dd></div><div><dt>Monthly income after your actions</dt><dd>${preciseCash(b.income_after_actions)}</dd></div><div><dt>Monthly spending after your actions</dt><dd>${preciseCash(b.spending_after_actions)}</dd></div><div><dt>Remaining monthly shortfall</dt><dd>${preciseCash(b.monthly_gap_after_actions)}</dd></div><div><dt>Further monthly improvement needed</dt><dd>${preciseCash(b.additional_monthly_improvement_needed)}</dd></div><div><dt>Monthly spending ceiling ${b.duration_months?'for '+b.duration_months+' months':'to stop drawing down savings'}</dt><dd>${preciseCash(b.maximum_monthly_spending_for_horizon)}</dd></div>${b.duration_months?`<div><dt>Projected end balance after actions</dt><dd>${preciseCash(b.ending_buffer_after_actions)}</dd></div><div><dt>Additional buffer without further monthly changes</dt><dd>${preciseCash(b.additional_buffer_for_horizon)}</dd></div>`:''}</dl>
 <ol class="plan-steps">${b.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol><small>${esc(b.assumption)}</small></article>
 <p id="planning-error" class="notice error" role="alert" hidden></p><button type="submit">Recalculate my plans ↗</button><p class="plan-help">Goal and backup inputs are editable planning choices. They are not inferred expenses or guaranteed future income.</p></form></section>`;
}
function bindPlanning(){
 const form=$('#planning-form');if(!form)return;
 form.onsubmit=async e=>{
  e.preventDefault();if(state.busy||!state.appliedShock)return;
  const fields=new FormData(form),settings={};
  for(const [k,v] of fields)settings[k]=v===''?null:Number(v);
  busy(true);
  try{const p=await api('/api/plan',{account_id:state.account,shock:state.appliedShock,planning:settings});state.planning=settings;state.plan=p;renderResults();
   const t=await api('/api/explain',p);$('#explanation').innerHTML=`<h3>What this means</h3><p>${esc(t.summary)}</p><h3>Your goal</h3><p>${esc(t.goal_plan_text)}</p><h3>Contingency plan</h3><p>${esc(t.backup_plan_text)}</p>${t.caveat?`<p class="warning">${esc(t.caveat)}</p>`:''}<small>Explanation source: ${esc(t.source)}</small>`;
  }catch(error){const box=$('#planning-error');box.hidden=false;box.textContent=error.message;}finally{busy(false);}
 };
}
function chart(p){const n=p.duration_assessment.months,a=p.after_shock;const vals=Array.from({length:n+1},(_,i)=>a.buffer+i*(a.income-a.spending));const hi=Math.max(1,...vals),lo=Math.min(0,...vals),y=v=>20+(hi-v)/(hi-lo)*110,x=i=>20+i/n*360;return `<div class="chart"><h3>Buffer through the scenario</h3><small>Approximation from rounded API values. Negative values represent unfunded spending, not approved borrowing.</small><svg viewBox="0 0 400 165" role="img" aria-label="Projected buffer over ${n} months"><line x1="20" y1="${y(0)}" x2="380" y2="${y(0)}" stroke="#cbd6ca" stroke-dasharray="4"/><polyline points="${vals.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="#1c594b" stroke-width="3"/><circle cx="380" cy="${y(vals[n])}" r="4" fill="#f0854e"/><text x="20" y="157" font-size="10" fill="#65746d">Now</text><text x="325" y="157" font-size="10" fill="#65746d">Month ${n}</text></svg></div>`;}
async function loadAccount(){const id=Number($('#account-id').value);busy(true);$('#page-error').hidden=true;try{const b=await api(`/api/accounts/${id}/baseline`);state.account=id;loadRecentQueries();state.baseline=b;state.plan=null;state.appliedShock=null;state.planning={};state.pending=null;state.amounts={};state.duration=null;state.incomePct=null;state.overlap=false;state.revision++;$('#messages').replaceChildren();message('What would you like to stress-test? I’ll ask for an estimate if the account data doesn’t identify a cost.');$('#result-label').textContent='Your baseline, before a shock.';renderBaseline();renderResults();}catch(e){$('#page-error').hidden=false;$('#page-error').textContent=e.message;}finally{busy(false);}}
function interpretation(result){const revision=state.revision;state.pending=result;const box=document.createElement('div');box.className='message';let html=`<p><strong>${result.status==='needs_input'?'A little more detail':'Review your scenario'}</strong></p><p>${esc(result.interpretation||'Please review the changes and assumptions below.')}</p>`;if(result.assumptions?.length)html+=`<ul>${result.assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`;
if(result.status==='needs_input'){const rephrase=result.questions.some(q=>q.kind==='rephrase');html+='<form class="clarify">';for(const q of result.questions){if(q.kind==='monthly_cost')html+=`<label>${esc(q.question)}<input type="number" name="amount_${esc(q.key)}" min="0" max="1000000" step="0.01" required placeholder="Monthly amount in CAD"></label>`;else if(q.kind==='income_percentage')html+=`<label>${esc(q.question)}<input type="number" name="incomePct" min="0" max="150" step="0.1" required placeholder="0 for no income, 55 for 55%"></label>`;else if(q.kind==='duration')html+=`<label>${esc(q.question)}<input type="number" name="duration" min="1" max="60" step="1" required></label>`;else if(q.kind==='confirmation')html+=`<label class="check"><input type="checkbox" name="overlap" required> ${esc(q.question)}</label>`;else html+=`<p class="error">Please revise your message: ${esc(q.question)}</p>`;}if(!rephrase)html+='<button type="submit">Use these values →</button>';html+='</form>';box.innerHTML=html;box.querySelector('form').onsubmit=async e=>{e.preventDefault();if(state.busy)return;if(revision!==state.revision){message("This interpretation has been replaced. Use the latest scenario.");return;}const fd=new FormData(e.target);for(const [k,v]of fd){if(k.startsWith('amount_'))state.amounts[k.slice(7)]=Number(v);if(k==='duration')state.duration=Number(v);if(k==='incomePct')state.incomePct=Number(v);if(k==='overlap')state.overlap=true;}busy(true);try{const r=await api('/api/resolve-shock',{account_id:state.account,draft:result.draft,category_amounts:state.amounts,duration_months:state.duration,income_replacement_pct:state.incomePct,overlap_acknowledged:state.overlap});box.querySelector('button')?.remove();interpretation(r);}catch(e){message(e.message);}finally{busy(false);}};
}else{html+=`<details><summary>See exact scenario inputs</summary><pre>${esc(JSON.stringify(result.shock,null,2))}</pre></details><button type="button">Apply this scenario ↗</button>`;box.innerHTML=html;box.querySelector('button').onclick=async()=>{if(state.busy)return;if(revision!==state.revision){message("This interpretation has been replaced. Use the latest scenario.");return;}busy(true);try{await apply(result.shock);box.querySelector('button').remove();}catch(e){message(e.message);}finally{busy(false);}};}
$('#messages').append(box);box.scrollIntoView({block:'nearest',behavior:'smooth'});}
async function apply(shock){const choices={target_months:state.planning.target_months??3,deadline_months:state.planning.deadline_months??12,monthly_contribution:state.planning.monthly_contribution??null};const p=await api('/api/plan',{account_id:state.account,shock,planning:choices});state.planning=choices;state.appliedShock=shock;state.plan=p;$('#result-label').textContent='Baseline versus your applied scenario.';renderBaseline();renderResults();message('Scenario applied. The comparison and funding plan are ready.');try{const t=await api('/api/explain',p);$('#explanation').innerHTML=`<h3>What this means</h3><p>${esc(t.summary)}</p><h3>Your goal</h3><p>${esc(t.goal_plan_text)}</p><h3>Contingency plan</h3><p>${esc(t.backup_plan_text)}</p>${t.caveat?`<p class="warning">${esc(t.caveat)}</p>`:''}<small>Explanation source: ${esc(t.source)}</small>`;}catch(e){$('#explanation').textContent='Calculations are available. Explanation unavailable: '+e.message;}}
$('#account-form').onsubmit=e=>{e.preventDefault();if(!state.busy)loadAccount();};
$('#chat-form').onsubmit=async e=>{e.preventDefault();if(state.busy||!state.baseline)return;const text=$('#query').value.trim();if(!text)return;state.revision++;rememberQuery(text);message(text,true);$('#query').value='';state.amounts={};state.duration=null;state.incomePct=null;state.overlap=false;busy(true);try{const r=await api('/api/parse-shock',{account_id:state.account,text});if(['ok','needs_input'].includes(r.status))interpretation(r);else{message(r.message||'No usable change was found. Try a more specific scenario.');if(r.status==='error')$('.manual').open=true;}}catch(e){message(e.message);}finally{busy(false);}};
$('#manual-form').onsubmit=e=>{e.preventDefault();if(state.busy)return;const f=new FormData(e.target);const duration=Number(f.get('duration'));const change=Number(f.get('recurring'));state.revision++;message('Manual scenario entered. Please review the amounts before applying.',true);interpretation({status:'ok',interpretation:'All changes are held constant during the selected assessment window.',assumptions:change?['Recurring amount is a user-supplied change, already net of the existing category cost.']:[],shock:{income_multiplier:Number(f.get('income'))/100,income_duration_months:duration,scenario_duration_months:duration,household_bills_pct_change:Number(f.get('bills')),one_off_costs:Number(f.get('oneoff'))?[{label:'Immediate expense',amount_dollars:Number(f.get('oneoff'))}]:[],recurring_costs:change?[{label:f.get('label'),monthly_change:change,source:'user_estimate'}]:[]}});};
(async()=>{try{const h=await api('/api/health');$('#health').textContent=h.gemini_enabled?'Gemini configured · local data':'Manual mode · Gemini disabled';const ids=await api('/api/accounts');$('#accounts').innerHTML=ids.account_ids.map(id=>`<option value="${id}"></option>`).join('');}catch(e){$('#health').textContent='Connection unavailable';}await loadAccount();})();
