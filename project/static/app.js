const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash = x => x == null ? '—' : new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(x);
const state = {account:20134, baseline:null, plan:null, pending:null, amounts:{}, duration:null, incomePct:null, overlap:false, busy:false, revision:0, peerCache:{}, recentQueries:[], effectDurations:{}, appliedShock:null, planning:{}};
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let j;try{j=await r.json()}catch{throw Error('Server returned an unreadable response.')}if(!r.ok)throw Error(typeof j.detail==='string'?j.detail:JSON.stringify(j.detail||j));return j;}
function busy(on){state.busy=on;document.querySelectorAll('button,input,textarea').forEach(e=>{if(!e.closest('.account-pagination'))e.disabled=on;});$('#send').textContent=on?'Working…':'Interpret ↗';}
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
function renderBaseline(){const b=state.baseline,p=state.plan;const base=p?.baseline||{income:b.income,spending:b.spending,buffer:b.buffer,runway_months:b.buffer<=0?0:b.spending<=b.income?'no_shortfall':Math.min(b.buffer/(b.spending-b.income),120).toFixed(1),runway_capped:b.spending>b.income&&b.buffer/(b.spending-b.income)>120};const cards=[['Monthly inflows',cash(b.income),'Median recorded money in'],['Monthly spending',cash(b.spending),'Median recorded money out'],['Household bills',cash(b.household_bills),'Typical monthly spending recorded as household bills'],['Fixed costs',cash(b.fixed_costs),'Median of monthly bills + insurance + loans'],['Savings buffer',cash(b.buffer),'Mean balance over last six months'],['Baseline runway',runway(base),base.runway_capped?'Capped at 120 months':'Under typical conditions']];$('#metrics').innerHTML=cards.map((c,i)=>`<div class="metric ${i===4?'highlight':''}"><label>${c[0]}</label><strong>${c[1]}</strong><small>${c[2]}</small></div>`).join('');$('#account-meta').textContent=`${b.months_of_history} observed months · Active loan payment ${cash(b.loan_payment)}/month`;renderStressInsights(b);}
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
 if(!s){$('#stress-insights').innerHTML='<section class="stress-block"><h2>What the account history shows</h2><p>Historical details are unavailable for this account. Your baseline and stress tests are still available.</p></section>';return;}
 const peer=b.peer_context,pension=b.pension_check;
 const reverse=s.reverse_stress,drift=s.spending_drift,bufferStatus=s.buffer_status;
 const share=s.cash_withdrawal_share==null?'—':`${(s.cash_withdrawal_share*100).toFixed(1)}%`;
 const shareValue=Math.max(0,Math.min(100,(s.cash_withdrawal_share||0)*100));
 const negativeRate=s.observations?100*s.negative_month_count/s.observations:0;
 const peerPercentile=Math.max(0,Math.min(100,peer.runway_percentile));
 const runwayText=(status,months)=>status==='no_shortfall'?'No monthly shortfall':`${months} months`;
 const balanceChange=Math.abs(s.balance_trend.recent_vs_prior_3_month_mean_change);
 const balanceDirection=s.balance_trend.falling?'lower':balanceChange===0?'the same':'higher';
 const summary=s.negative_month_count>0
  ?`${s.negative_month_count} months in the recorded history had at least one day below $0.`
  :'No day below $0 appears in the recorded history.';
 const riskBandClass={
  'Lower relative ranking':'risk-band-lower',
  'Middle relative ranking':'risk-band-middle',
  'Higher relative ranking':'risk-band-higher',
 }[s.loan_risk?.band]||'';
 const html=`<section class="stress-block" aria-labelledby="stress-title">
  <div class="stress-heading">
   <div><p class="eyebrow">A closer look at the history</p><h2 id="stress-title">What the account history shows</h2><p>${summary} These are historical signals, not a prediction.</p><p class="history-source">History: bundled challenge snapshot through ${esc(s.last_month)}. Baseline amounts use the currently configured account data.</p></div>
  </div>
  <div class="stress-grid">
   <article class="stress-stat ${s.negative_month_count?'warning':''}"><small>Months with a day below $0</small><strong>${s.negative_month_count} <span>of ${s.observations}</span></strong><progress class="signal-progress negative-progress" max="100" value="${negativeRate}" aria-label="${negativeRate.toFixed(1)} percent of observed months had a day below zero"></progress><p>A month is counted if the balance went below zero on any day.</p></article>
   <article class="stress-stat ${s.worst_observed_balance<0?'warning':''}"><small>Lowest recorded balance</small><strong>${cash(s.worst_observed_balance)}</strong><p>Lowest point seen in the available history.</p></article>
   <article class="stress-stat"><small>Cash withdrawals</small><strong>${share}</strong><progress class="signal-progress cash-progress" max="100" value="${shareValue}" aria-label="${share} of recorded money out was cash withdrawals"></progress><p>Share of recorded money out. Withdrawals are not assumed to be optional spending.</p></article>
   <article class="stress-stat"><small>Loan payments</small><div class="stress-pair"><span><strong>${cash(s.loan_contract_monthly_payment)}</strong><small>Scheduled amount</small></span><span><strong>${cash(s.median_observed_loan_payment)}</strong><small>Typical recorded month</small></span></div><p>${esc(s.loan_status_meaning)}. Recorded payments can be zero in months without a payment.</p></article>
   <article class="stress-stat loan-risk-stat"><small>${esc(s.loan_risk?.label||'Experimental relative loan-risk ranking')}</small>${s.loan_risk?.available?`<strong>${esc(s.loan_risk.band)}</strong><div class="loan-risk-scale ${riskBandClass}" role="img" aria-label="${esc(s.loan_risk.band)} among ongoing loans; this is not a probability of default"><div class="loan-risk-track"><span class="loan-risk-marker"></span></div><div class="loan-risk-labels"><span>Lower</span><span>Middle</span><span>Higher</span></div></div><p>Relative position among ${s.loan_risk.comparison_group_size} ongoing loans. Uses three complete months before loan origination (${s.loan_risk.completed_defaults} defaults among ${s.loan_risk.completed_training_loans} completed training loans).</p><p>${esc(s.loan_risk.caveat)}</p>`:`<strong>Not available</strong><p>${esc(s.loan_risk?.reason||'No comparable loan data available.')}</p>`}</article>
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
  </div>
  ${pension?`<article class="insight-panel pension-note"><h3>Pension income comparison</h3><p>Official runway: <strong>${runwayText(pension.official_baseline_runway_status,pension.official_baseline_runway_months)}</strong>. EI-at-55% comparison: <strong>${runwayText(pension.ei55_runway_status,pension.ei55_runway_months)}</strong>.</p><p>Employment Insurance does not apply to pension income. The EI figure is an illustrative comparison only.</p></article>`:''}
  <div class="insight-panels">
   <article class="insight-panel ${reverse.baseline_coverage?'':'warning'}">
    <h3>Six-month income resilience</h3>
    ${reverse.maximum_income_loss_pct===null
      ?'<p class="meter-status">No positive stress margin</p>'
      :`<div class="resilience-meter"><div class="meter-track"><span class="meter-fill" style="width:${reverse.maximum_income_loss_pct}%"></span><i class="meter-target" aria-hidden="true"></i></div><div class="meter-scale"><span>0% income loss</span><span>50% target</span><span>100%</span></div></div>`}
    <p>${reverse.maximum_income_loss_pct===null
      ?b.income===0
        ?'Typical recorded income is $0, so an income-loss percentage does not apply.'
        :'The buffer does not cover a full six months at baseline income, so there is no survivable income-loss margin.'
      :`At most <strong>${reverse.maximum_income_loss_pct}%</strong> of typical income could be lost while the buffer still covers six months.`}</p>
    <p>${reverse.baseline_coverage?'The baseline cash flow is covered for the full six-month horizon.':'The buffer does not cover six months even at baseline income.'}</p>
    <p>Additional buffer to withstand income at 50% for six months: <strong>${cash(reverse.additional_buffer_for_target)}</strong>.</p>
    <p>Assumes spending stays constant and uses the buffer for any monthly gap; this is a scenario, not a forecast.</p>
   </article>
   <article class="insight-panel ${drift.flag?'warning':''}">
    <h3>Recent spending versus last year</h3>
    ${drift.available
      ?`<div class="compare-bars" role="img" aria-label="Recent spending is ${drift.ratio.toFixed(2)} times the same months a year earlier"><div><span>Same months last year</span><i><b style="width:${Math.min(100,100/Math.max(1,drift.ratio))}%"></b></i><strong>${cash(drift.same_months_prior_year)}</strong></div><div><span>Recent three months</span><i><b style="width:${Math.min(100,100*drift.ratio/Math.max(1,drift.ratio))}%"></b></i><strong>${cash(drift.recent_three_months)}</strong></div></div><p class="insight-takeaway">${drift.flag?`Spending was ${drift.ratio.toFixed(2)}× the prior-year comparison (above the 1.5× review threshold).`:`No 1.5× spending-drift signal in this comparison.`}</p>`
      :'<p>Not enough comparable history, or the prior-year spending total was zero.</p>'}
    <p>This comparison flags a change in recorded outflows; it does not explain the cause or predict future spending.</p>
   </article>
   <article class="insight-panel ${bufferStatus.below_half?'warning':''}">
    <h3>Latest balance versus buffer</h3>
    ${bufferStatus.available
      ?`<div class="buffer-meter" role="img" aria-label="Latest balance is ${(bufferStatus.latest_to_buffer_ratio*100).toFixed(0)} percent of the official buffer"><div class="buffer-track"><span class="buffer-fill" style="width:${Math.max(0,Math.min(100,100*bufferStatus.latest_to_buffer_ratio))}%"></span><i class="buffer-quarter" aria-hidden="true"></i><i class="buffer-half" aria-hidden="true"></i></div><div class="meter-scale"><span>0</span><span>50% review mark</span><span>100%</span></div></div>`
      :'<p class="meter-status">Relative comparison unavailable</p>'}
    <p>Latest month-end balance: <strong>${cash(bufferStatus.latest_month_end_balance)}</strong>. Official six-month average-balance buffer: <strong>${cash(bufferStatus.baseline_buffer)}</strong>.</p>
    <p class="insight-takeaway">${!bufferStatus.available
      ?'A relative comparison is unavailable because the official buffer is not positive.'
      :bufferStatus.below_quarter
        ?'The latest month-end balance is below one quarter of the official buffer.'
        :bufferStatus.below_half
          ?'The latest month-end balance is below half of the official buffer.'
          :'The latest month-end balance is at least half of the official buffer.'}</p>
    <p>Month-end is a snapshot and can differ from the six-month average used in the baseline.</p>
   </article>
  </div>
 </section>`;
 $('#stress-insights').innerHTML=html;
}
function renderResults(){const p=state.plan,b=state.baseline;$('.results-panel').classList.toggle('awaiting-scenario',!p);if(!p){$('#results').innerHTML='<div class="empty scenario-empty"><h3>Apply a stress test to see the results</h3><p>Describe a change, review the scenario, then select “Apply this scenario” to see its impact here.</p></div>'+`<details class="data"><summary>Explore the full account baseline</summary><pre>${esc(JSON.stringify(b,null,2))}</pre></details>`;return;}
const a=p.after_shock;const rows=[['Monthly inflows',cash(p.baseline.income),cash(a.income)],['Monthly spending',cash(p.baseline.spending),cash(a.spending)],['Buffer after immediate costs',cash(p.baseline.buffer),cash(a.buffer)],['Monthly shortfall',cash(Math.max(b.spending-b.income,0)),cash(a.monthly_gap)],[p.monthly_projection?'Runway if month 1 continued':'Runway',runway(p.baseline),runway(a)],['Immediate expense','—',cash(a.one_off_costs||0)]];
let html=`<table class="comparison"><thead><tr><th>Account ${state.account}</th><th>Before</th><th>${p.monthly_projection?'Month 1':'After'}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table>`;
const d=p.duration_assessment;if(d){html+=`<div class="outcome ${d.covers_duration?'':'danger'}"><h3>${d.covers_duration?'Covered':'Funding gap'} over ${d.months} months</h3><p>${esc(d.assumption)}</p><div class="mini-grid"><div class="mini"><small>Required starting buffer</small><strong>${cash(d.required_starting_buffer)}</strong></div><div class="mini"><small>Additional buffer needed</small><strong>${cash(d.additional_buffer_needed)}</strong></div></div></div>`;html+=chart(p);}
html+=`<div class="mini-grid"><div class="mini"><small>Required monthly spending reduction</small><strong>${cash(p.backup_plan.monthly_cut_needed)}</strong></div><div class="mini"><small>Immediate funding needed</small><strong>${cash(p.backup_plan.upfront_funding_needed)}</strong></div><div class="mini"><small>Emergency-fund target</small><strong>${cash(p.goal_plan.target_amount)}</strong></div>${goalTimelineCard(p)}</div>${renderActionPlan(p)}<div id="explanation" class="explanation"><p>Preparing the explanation…</p></div><details class="data"><summary>Inspect all calculated values and account data</summary><pre>${esc(JSON.stringify({account:b,plan:p},null,2))}</pre></details>`;$('#results').innerHTML=html;bindPlanning();loadPeerComparison();}
function goalTimelineCard(p){
 const g=p.action_plan?.goal,legacy=p.goal_plan;
 const months=g?g.months_to_goal:legacy.months_to_goal;
 const contribution=g?g.monthly_contribution:legacy.monthly_savings_capacity;
 let title,detail;
 if(months===0){title='Already funded';detail='Your current buffer meets your emergency-fund target.';}
 else if(months!=null&&contribution>0){title=`${months} ${months===1?'month':'months'}`;detail=`By saving ${preciseCash(contribution)} each month from your normal income.`;if(g&&!g.deadline_met_at_selected_contribution)detail+=` This is beyond your ${g.deadline_months}-month goal; increase saving or extend the deadline in Plan.`;}
 else if(g&&g.baseline_monthly_surplus<0){title='Close the monthly gap first';detail=`Spending currently exceeds normal income by ${preciseCash(-g.baseline_monthly_surplus)}/month. To reach the fund in ${g.deadline_months} months, improve cash flow by ${preciseCash(g.monthly_cash_flow_improvement_for_deadline)}/month in total, including ${preciseCash(g.monthly_saving_for_deadline)} for saving.`;}
 else if(g&&g.available_monthly_saving===0){title='Make room to save';detail=`Income currently covers spending with nothing left to save. Free up ${preciseCash(g.monthly_saving_for_deadline)}/month to reach the target in ${g.deadline_months} months.`;}
 else {title='Choose a saving amount';detail='Set a monthly contribution in Plan to calculate your timeline.';}
 return `<div class="mini goal-timeline"><small>Time to build your emergency fund</small><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
}
function displayExplanation(t){
 $('#explanation').innerHTML=`<section class="stress-explanation"><h3>What this shock changes</h3><p>${esc(t.summary)}</p>${estimateNote()}</section><section class="planning-explanation"><h3>Building your emergency fund</h3><p>${esc(t.goal_plan_text)}</p><h3>Your backup budget</h3><p>${esc(t.backup_plan_text)}</p>${estimateNote()}</section>`;
}
function estimateNote(){
 const s=state.appliedShock,p=state.planning;
 const hasEstimate=s && (s.one_off_costs?.length || s.recurring_costs?.length || (s.income_multiplier!=null&&s.income_multiplier!==1) || s.household_bills_pct_change || s.spending_pct_change || p.monthly_contribution!=null || p.confirmed_monthly_cut || p.confirmed_extra_income || p.confirmed_upfront_funds);
 return hasEstimate?'<p class="estimate-note">Plans and calculations are based on your estimates alongside recorded account data.</p>':'';
}
const preciseCash = n => n == null ? '—' : new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',minimumFractionDigits:2}).format(n);
function planSteps(steps){return steps.length===1?`<p class="plan-single-step">${esc(steps[0])}</p>`:`<ol class="plan-steps">${steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;}
function timingFields(data,ready=false){
 const effects=[];
 if(data.income_change_requested||data.income_multiplier!=null)effects.push(['income','Income change',data.income_duration_months]);
 if(data.household_bills_pct_change)effects.push(['bills','Household bills',null]);
 if(data.spending_pct_change)effects.push(['spending','Overall spending',null]);
 (data.category_changes||data.recurring_costs||[]).forEach((c,i)=>effects.push(['category_'+i,c.category||c.label,c.duration_months]));
 if(!effects.length)return '';
 const horizon=data.scenario_duration_months||data.income_duration_months||null;
 return `<fieldset class="effect-timings"><legend>How long does each change last?</legend><p>All changes start now. After its selected month, each change returns to the account’s normal level. One-off costs are paid once, upfront.</p>${effects.map(([key,label,duration])=>`<label>${esc(label)} — months<input type="number" name="effect_${key}" min="1" max="60" step="1" value="${duration??data.effect_durations?.[key]??horizon??''}" placeholder="Whole assessment period" required></label>`).join('')}${ready?`<label>View results over (months)<input type="number" name="assessment" min="1" max="60" step="1" value="${horizon??Math.max(1,...effects.map(([k,l,d])=>d||data.effect_durations?.[k]||1))}" required></label>`:''}</fieldset>`;
}
function renderActionPlan(p){
 const a=p.action_plan;if(!a)return '';
 const g=a.goal,b=a.backup,settings=state.planning;
 const selected=settings.monthly_contribution??'';
 const goalStatus={target_met:'Target already met',no_surplus:'Restore cash flow first',no_contribution:'Choose a saving amount',saving:'Build your buffer'};
 const backupStatus={immediate_funding_gap:'Immediate funding still needed',covered:'Proposed budget covers the shock',funding_gap:'More changes are needed',stabilized:'Monthly cash flow is balanced',needs_duration:'Choose a horizon to check coverage'};
 return `<section class="action-plans" aria-labelledby="make-plan-title"><div class="section-title"><h2 id="make-plan-title">Make a plan</h2><span>Your choices + this account’s numbers</span></div>
 <form id="planning-form"><article class="plan-card"><p class="eyebrow">STEP 1 · BUILD YOUR BUFFER</p><h3>Your goal plan</h3><p class="plan-help">Start with the suggested 3-month fund and 12-month deadline, or change them below. You can also choose your own dollar target. These are your choices, not fixed requirements.</p><p class="plan-status">${esc(goalStatus[g.status])}</p>
 <div class="form-grid"><label>Emergency fund (months of normal spending)<input name="target_months" type="number" min="1" max="12" step="1" value="${g.target_months}" required></label><label>Goal deadline (months)<input name="deadline_months" type="number" min="1" max="120" step="1" value="${g.deadline_months}" required></label><label>Or set your own fund target ($)<input name="target_amount_override" type="number" min="0.01" max="1000000" step="0.01" value="${g.target_amount_override??''}" placeholder="Leave blank to use months of spending"></label><label>Monthly saving contribution ($)<input name="monthly_contribution" type="number" min="0.01" max="1000000" step="0.01" value="${esc(selected)}" placeholder="Automatic: ${g.available_monthly_saving.toFixed(2)}"></label></div>
 <p class="goal-formula">${g.target_basis==='custom_amount'?`Your chosen target: <strong>${preciseCash(g.target_amount)}</strong>`:`${g.target_months} months × ${preciseCash(g.normal_monthly_spending??state.baseline.spending)} normal monthly spending = <strong>${preciseCash(g.target_amount)}</strong>`}</p><p class="plan-help">Still to build = your target minus the current buffer. A blank monthly contribution uses the available surplus; the deadline determines how much you would need to save each month.</p>
 <div class="goal-progress"><div style="width:${g.progress_pct}%"></div></div><small>${g.progress_pct}% of target covered by the current buffer</small>
 <dl class="plan-numbers"><div><dt>Target buffer</dt><dd>${preciseCash(g.target_amount)}</dd></div><div><dt>Still to build</dt><dd>${preciseCash(g.amount_still_needed)}</dd></div><div><dt>Available monthly surplus</dt><dd>${preciseCash(g.available_monthly_saving)}</dd></div><div><dt>Selected monthly saving</dt><dd>${preciseCash(g.monthly_contribution)}</dd></div><div><dt>Time at this saving pace</dt><dd>${g.months_to_goal===null?'Not reachable yet':g.months_to_goal===0?'Already funded':g.months_to_goal+' whole months'}</dd></div><div><dt>Saving needed for your deadline</dt><dd>${preciseCash(g.monthly_saving_for_deadline)}/month</dd></div></dl>
 ${planSteps(g.steps)}</article>
 <article class="plan-card"><p class="eyebrow">STEP 2 · PREPARE FOR THE SHOCK</p><h3>Your backup plan</h3><p class="plan-help">Enter monthly changes you can make and any funds available now. Start with zero, then test what closes the gap.</p><p class="plan-status">${esc(backupStatus[b.status])}</p>
 <div class="form-grid"><label>Confirmed spending reduction ($/month)<input name="confirmed_monthly_cut" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_monthly_cut}" required></label><label>Confirmed extra income ($/month)<input name="confirmed_extra_income" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_extra_income}" required></label><label>Confirmed upfront funds ($)<input name="confirmed_upfront_funds" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_upfront_funds}" required></label></div>
 <dl class="plan-numbers"><div><dt>Immediate funding still needed</dt><dd>${preciseCash(b.remaining_immediate_funding_gap)}</dd></div><div><dt>Month-one income after your actions</dt><dd>${preciseCash(b.income_after_actions)}</dd></div><div><dt>Month-one spending after your actions</dt><dd>${preciseCash(b.spending_after_actions)}</dd></div><div><dt>Month-one shortfall</dt><dd>${preciseCash(b.monthly_gap_after_actions)}</dd></div><div><dt>Further monthly improvement needed</dt><dd>${preciseCash(b.additional_monthly_improvement_needed)}</dd></div><div><dt>Month-one spending ceiling ${b.duration_months?'for '+b.duration_months+' months':'to stop drawing down savings'}</dt><dd>${preciseCash(b.maximum_monthly_spending_for_horizon)}</dd></div>${b.duration_months?`<div><dt>Projected end balance after actions</dt><dd>${preciseCash(b.ending_buffer_after_actions)}</dd></div><div><dt>Additional buffer without further monthly changes</dt><dd>${preciseCash(b.additional_buffer_for_horizon)}</dd></div>`:''}</dl>
 ${planSteps(b.steps)}</article>
 <section id="peer-comparison" class="peer-comparison"><h3>Find areas to review</h3><p>Finding accounts with similar income, fixed costs and loan payments…</p></section>
 <p id="planning-error" class="notice error" role="alert" hidden></p><button type="submit">Update my goal & backup budget →</button></form></section>`;
}
function bindPlanning(){
 const form=$('#planning-form');if(!form)return;
 form.onsubmit=async e=>{
  e.preventDefault();if(state.busy||!state.appliedShock)return;
  const fields=new FormData(form),settings={};
  for(const [k,v] of fields)settings[k]=v===''?null:Number(v);
  busy(true);
  try{const p=await api('/api/plan',{account_id:state.account,shock:state.appliedShock,planning:settings});state.planning=settings;state.plan=p;renderResults();
   const t=await api('/api/explain',p);displayExplanation(t);
  }catch(error){const box=$('#planning-error');box.hidden=false;box.textContent=error.message;}finally{busy(false);}
 };
}
async function loadPeerComparison(){
 const box=$('#peer-comparison');if(!box)return;
 const account=state.account;
 try{
  const data=state.peerCache[account]??await api(`/api/accounts/${account}/peers`);
  if(account!==state.account||!box.isConnected)return;
  state.peerCache[account]=data;
  const method=`<details><summary>How these accounts were matched</summary><p>${esc(data.method.description)}</p><p>The comparison uses monthly account metrics, not individual purchase categories. Loan matching uses payment amounts, not loan balances or interest rates. Household size and location are not part of the match.</p></details>`;
  if(data.status!=='ok'){box.innerHTML=`<p class="eyebrow">PEER COMPARISON</p><h3>Find areas to review</h3><p>${esc(data.message)}</p>${method}`;return;}
  const above=data.comparisons.filter(c=>c.above_median).sort((a,b)=>b.difference-a.difference);
  box.innerHTML=`<p class="eyebrow">PEER COMPARISON · ${data.peer_count} SIMILAR ACCOUNTS</p><h3>Where could you spend less?</h3><p>${esc(data.message)}</p><div class="peer-table-wrap"><table class="comparison"><thead><tr><th>Monthly area</th><th>You</th><th>Peer median</th><th>Difference</th></tr></thead><tbody>${data.comparisons.map(c=>`<tr><td>${esc(c.label)}</td><td>${preciseCash(c.your_amount)}</td><td>${preciseCash(c.peer_median)}</td><td class="${c.above_median?'above-median':''}">${c.above_median?'+':''}${preciseCash(c.difference)}</td></tr>`).join('')}</tbody></table></div>
  ${above.length?`<h4>Start by reviewing these areas</h4><div class="peer-review-list">${above.map(c=>`<article><strong>${esc(c.label)} · ${preciseCash(c.difference)} above the median</strong><p>${esc(c.review)}</p></article>`).join('')}</div><div class="peer-budget-choice"><label>After reviewing your spending, how much could you reduce per month?<input id="peer-cut-choice" type="number" min="0" max="${state.plan.after_shock.spending}" step="0.01" value="${state.planning.confirmed_monthly_cut??0}"></label><button type="button" id="use-peer-cut">Use this in my backup budget</button><p id="peer-cut-status" role="status"></p></div>`:'<p>No measured area is above this peer median. That does not guarantee the current budget is affordable; use your own costs and goal to decide what to change.</p>'}
  <p class="peer-note">An above-median amount is a review opportunity, not proof of overspending. Total outflow includes overlapping channels; do not add their gaps together. No cuts are applied automatically.</p>${method}`;
  const button=$('#use-peer-cut');if(button)button.onclick=()=>{const input=$('#peer-cut-choice');if(!input.reportValidity())return;const target=$('#planning-form input[name="confirmed_monthly_cut"]');target.value=input.value;$('#peer-cut-status').textContent=`${preciseCash(Number(input.value))}/month entered in your backup budget. Select “Update my goal & backup budget” to test it.`;};
 }catch(error){if(account===state.account&&box.isConnected)box.innerHTML=`<h3>Peer comparison unavailable</h3><p>${esc(error.message)}</p><p>Your own account plan is still available.</p>`;}
}
function chart(p){
 const n=p.duration_assessment.months,a=p.after_shock;
 const net=(p.duration_assessment.ending_buffer-a.buffer)/n,values=p.monthly_projection?p.monthly_projection.map(d=>({month:d.month,value:d.balance})):Array.from({length:n+1},(_,i)=>({month:i,value:a.buffer+i*net}));
 const end=values[n].value,top=Math.max(1,...values.map(d=>d.value)),bottom=Math.min(0,...values.map(d=>d.value));
 const pad=(top-bottom)*.14,hi=top+pad,lo=bottom<0?bottom-pad:0;
 const left=76,right=568,up=34,down=242,x=m=>left+m/n*(right-left),y=v=>up+(hi-v)/(hi-lo)*(down-up);
 const compact=v=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',notation:'compact',maximumFractionDigits:1}).format(v);
 let exhausted=values[0].value<=0?0:null;
 const points=[values[0]];
 for(let i=1;i<values.length;i++){
  const prev=values[i-1],next=values[i];
  if(prev.value*next.value<0){const month=prev.month+prev.value/(prev.value-next.value);points.push({month,value:0});}
  if(exhausted===null&&next.value<=0)exhausted=prev.month+prev.value/(prev.value-next.value);
  points.push(next);
 }
 const path=pts=>pts.map((d,i)=>`${i?'L':'M'}${x(d.month).toFixed(2)},${y(d.value).toFixed(2)}`).join(' ');
 const segments=sign=>{const result=[];let current=[];for(const point of points){if(sign*point.value>=0)current.push(point);else{if(current.length)result.push(current);current=[];}}if(current.length)result.push(current);return result;};
 const positive=segments(1),negative=segments(-1);
 const area=pts=>pts.length>1?`${path(pts)} L${x(pts.at(-1).month)},${y(0)} L${x(pts[0].month)},${y(0)} Z`:'';
 const ticks=n<=12?Array.from({length:n+1},(_,i)=>i):Array.from(new Set([0,...Array.from({length:6},(_,i)=>Math.round(n*(i+1)/6))]));
 const grid=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4).filter(v=>Math.abs(v)>(hi-lo)*.03).map(v=>`<g><line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="projection-grid"/><text x="${left-12}" y="${y(v)+4}" text-anchor="end">${compact(v)}</text></g>`).join('');
 const status=exhausted!==null?`Savings run out ${exhausted===0?'immediately':'around month '+exhausted.toFixed(1)}`:`Buffer lasts through month ${n}`;
 return `<section class="chart projection"><div class="projection-heading"><div><h3>Your savings over time</h3><p>What happens if this scenario continues for ${n} months?</p></div><span class="projection-pill ${exhausted!==null?'shortfall':''}">${exhausted!==null?'Funding gap':'Covered'}</span></div>
 <div class="projection-stats"><div><small>After immediate costs</small><strong>${cash(a.buffer)}</strong></div><span aria-hidden="true">→</span><div><small>${end<0?'Unfunded by':'Projected at'} month ${n}</small><strong class="${end<0?'projection-loss':''}">${cash(Math.abs(end))}</strong></div></div>
 <svg viewBox="0 0 600 296" role="img" aria-label="Savings projection: starts at ${cash(a.buffer)}, ends at ${cash(end)} after ${n} months. ${esc(status)}."><defs><linearGradient id="buffer-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f58220" stop-opacity=".24"/><stop offset="100%" stop-color="#f58220" stop-opacity=".02"/></linearGradient></defs>
 ${grid}<path d="${positive.map(area).join(" ")}" fill="url(#buffer-fill)"/><path d="${negative.map(area).join(" ")}" fill="#c8344b" fill-opacity=".08"/>
 <line x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}" class="projection-zero"/><text x="${left-12}" y="${y(0)+4}" text-anchor="end">$0</text>
 <path d="${positive.map(path).join(" ")}" class="projection-line"/><path d="${negative.map(path).join(" ")}" class="projection-line negative"/>
 ${values.map(d=>{const label=`${d.month===0?'Now':'Month '+d.month} · ${cash(Math.abs(d.value))}${d.value<0?' unfunded':' remaining'}`;return `<g class="projection-point" tabindex="0" role="button" aria-label="${esc(label)}" data-balance-label="${esc(label)}"><circle cx="${x(d.month)}" cy="${y(d.value)}" r="15" fill="transparent"/><circle cx="${x(d.month)}" cy="${y(d.value)}" r="${d.month===0||d.month===n?5:3}" fill="${d.value<0?'#c8344b':'#f58220'}" stroke="white" stroke-width="2"/></g>`;}).join('')}

 ${exhausted!==null&&exhausted>0?`<circle cx="${x(exhausted)}" cy="${y(0)}" r="6" fill="white" stroke="#c8344b" stroke-width="2"><title>Savings exhausted around month ${exhausted.toFixed(1)}</title></circle>`:''}
 ${ticks.map(m=>`<text x="${x(m)}" y="268" text-anchor="middle">${m===0?'Now':'Mo '+m}</text>`).join('')}<text x="322" y="291" text-anchor="middle">Months after shock</text></svg>
 <div class="projection-caption ${exhausted!==null?'projection-loss':''}"><span class="projection-dot"></span>${esc(status)}</div><p class="projection-note">${end<0?'The dashed red line shows spending that savings cannot cover. ':''}${p.monthly_projection?'Each change ends after its selected duration.':'Income and spending stay constant over this period.'} Hover, tap, or focus a point for its balance.</p>
 <details class="balance-calculation"><summary>How this balance is calculated</summary><p>The starting buffer is the average daily account balance over the last six recorded months. It estimates funds already available; it is not money added every month.</p>
 <dl><div><dt>Historical starting buffer</dt><dd>${preciseCash(p.action_plan?.goal.current_buffer??p.baseline.buffer)}</dd></div><div><dt>Immediate scenario costs</dt><dd>− ${preciseCash(p.action_plan?.backup.one_off_cost??a.one_off_costs??0)}</dd></div><div><dt>Available after immediate costs</dt><dd>${preciseCash(p.action_plan?.backup.buffer_after_expense??a.buffer)}</dd></div><div><dt>Monthly income after the shock</dt><dd>${preciseCash(p.action_plan? p.action_plan.backup.income_after_actions-p.action_plan.backup.confirmed_extra_income:a.income)}</dd></div><div><dt>Monthly spending after the shock</dt><dd>− ${preciseCash(p.action_plan? p.action_plan.backup.spending_after_actions+p.action_plan.backup.confirmed_monthly_cut:a.spending)}</dd></div><div><dt>${p.monthly_projection?'Month-one net change':'Net monthly change'}</dt><dd>${preciseCash(p.action_plan? p.action_plan.backup.income_after_actions-p.action_plan.backup.confirmed_extra_income-p.action_plan.backup.spending_after_actions-p.action_plan.backup.confirmed_monthly_cut:net)}</dd></div></dl>
 ${p.monthly_projection?`<div class="monthly-table-wrap"><table class="comparison"><thead><tr><th>Month</th><th>Income</th><th>Spending</th><th>Balance</th></tr></thead><tbody>${p.monthly_projection.slice(1).map(m=>`<tr><td>${m.month}</td><td>${preciseCash(m.income)}</td><td>${preciseCash(m.spending)}</td><td>${preciseCash(m.balance)}</td></tr>`).join('')}</tbody></table></div><p>Each month’s balance = the previous balance + that month’s income − that month’s spending. Temporary changes stop after their selected duration.</p>`:`<p class="balance-equation">Month ${n}: ${cash(a.buffer)} + (${cash(net)} × ${n}) = <strong>${cash(end)}</strong></p><p>Each month, income replenishes the balance and spending draws it down. The historical buffer is not added again.</p>`}</details></section>`;
}
async function loadAccount(){const id=Number($('#account-id').value);busy(true);$('#page-error').hidden=true;try{const b=await api(`/api/accounts/${id}/baseline`);state.account=id;state.peerCache={};$('#selected-account').textContent=id;loadRecentQueries();state.baseline=b;state.plan=null;state.appliedShock=null;state.planning={};state.pending=null;state.amounts={};state.effectDurations={};state.duration=null;state.incomePct=null;state.overlap=false;state.revision++;$('#messages').replaceChildren();message('What would you like to stress-test? I’ll ask for an estimate if the account data doesn’t identify a cost.');$('#result-label').textContent='No stress test applied yet.';renderBaseline();renderResults();}catch(e){$('#page-error').hidden=false;$('#page-error').textContent=e.message;}finally{busy(false);}}
function interpretation(result){const revision=state.revision;state.pending=result;const box=document.createElement('div');box.className='message';let html=`<p><strong>${result.status==='needs_input'?'A little more detail':'Review your scenario'}</strong></p><p>${esc(result.interpretation||'Please review the changes and assumptions below.')}</p>`;if(result.assumptions?.length)html+=`<ul>${result.assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`;
if(result.status==='needs_input'){const timings=timingFields(result.draft);const rephrase=result.questions.some(q=>q.kind==='rephrase');html+='<form class="clarify">';for(const q of result.questions){if(q.kind==='duration'&&timings)continue;if(q.kind==='monthly_cost')html+=`<label>${esc(q.question)}<input type="number" name="amount_${esc(q.key)}" min="0" max="1000000" step="0.01" required placeholder="Monthly amount in CAD"></label>`;else if(q.kind==='income_percentage')html+=`<label>${esc(q.question)}<input type="number" name="incomePct" min="0" max="150" step="0.1" required placeholder="0 for no income, 55 for 55%"></label>`;else if(q.kind==='duration')html+=`<label>${esc(q.question)}<input type="number" name="duration" min="1" max="60" step="1" required></label>`;else if(q.kind==='confirmation')html+=`<label class="check"><input type="checkbox" name="overlap" required> ${esc(q.question)}</label>`;else html+=`<p class="error">Please revise your message: ${esc(q.question)}</p>`;}html+=timings;if(!rephrase)html+='<button type="submit">Use these values →</button>';html+='</form>';box.innerHTML=html;box.querySelector('form').onsubmit=async e=>{e.preventDefault();if(state.busy)return;if(revision!==state.revision){message("This interpretation has been replaced. Use the latest scenario.");return;}const fd=new FormData(e.target);for(const [k,v]of fd){if(k.startsWith('amount_'))state.amounts[k.slice(7)]=Number(v);if(k==='duration')state.duration=Number(v);if(k==='incomePct')state.incomePct=Number(v);if(k==='overlap')state.overlap=true;if(k.startsWith('effect_')&&v!=='')state.effectDurations[k.slice(7)]=Number(v);}busy(true);try{const r=await api('/api/resolve-shock',{account_id:state.account,draft:result.draft,category_amounts:state.amounts,duration_months:state.duration,income_replacement_pct:state.incomePct,overlap_acknowledged:state.overlap,effect_durations:state.effectDurations});box.querySelector('button')?.remove();interpretation(r);}catch(e){message(e.message);}finally{busy(false);}};
}else{html+=`<details><summary>See exact scenario inputs</summary><pre>${esc(JSON.stringify(result.shock,null,2))}</pre></details><form class="scenario-timing-form">${timingFields(result.shock,true)}<button type="button">Apply this scenario ↗</button></form>`;box.innerHTML=html;box.querySelector('button').onclick=async()=>{if(state.busy)return;if(revision!==state.revision){message("This interpretation has been replaced. Use the latest scenario.");return;}try{
 const form=box.querySelector('.scenario-timing-form');if(!form.reportValidity())return;
 const shock=JSON.parse(JSON.stringify(result.shock)),fields=new FormData(form),effects={...shock.effect_durations};
 for(const [key,value] of fields)if(key.startsWith('effect_'))effects[key.slice(7)]=Number(value);
 if(Object.keys(effects).length){shock.effect_durations=effects;shock.scenario_duration_months=Math.max(Number(fields.get('assessment')||1),...Object.values(effects));if(effects.income)shock.income_duration_months=effects.income;}
 busy(true);await apply(shock);box.querySelector('button').remove();}catch(e){message(e.message);}finally{busy(false);}};}
$('#messages').append(box);box.scrollIntoView({block:'nearest',behavior:'smooth'});}
async function apply(shock){const choices={target_amount_override:state.planning.target_amount_override??null,target_months:state.planning.target_months??3,deadline_months:state.planning.deadline_months??12,monthly_contribution:state.planning.monthly_contribution??null};const p=await api('/api/plan',{account_id:state.account,shock,planning:choices});state.planning=choices;state.appliedShock=shock;state.plan=p;$('#result-label').textContent='Baseline versus your applied scenario.';renderBaseline();renderResults();message('Scenario applied. The comparison and funding plan are ready.');try{const t=await api('/api/explain',p);displayExplanation(t);}catch(e){$('#explanation').textContent='Calculations are available. Explanation unavailable: '+e.message;}}
$('#account-form').onsubmit=e=>{e.preventDefault();if(!state.busy)loadAccount();};
$('#chat-form').onsubmit=async e=>{e.preventDefault();if(state.busy||!state.baseline)return;const text=$('#query').value.trim();if(!text)return;state.revision++;rememberQuery(text);message(text,true);$('#query').value='';state.amounts={};state.effectDurations={};state.duration=null;state.incomePct=null;state.overlap=false;busy(true);try{const r=await api('/api/parse-shock',{account_id:state.account,text});if(['ok','needs_input'].includes(r.status))interpretation(r);else{message(r.message||'No usable change was found. Try a more specific scenario.');if(r.status==='error')$('.manual').open=true;}}catch(e){message(e.message);}finally{busy(false);}};
$('#manual-form').onsubmit=e=>{e.preventDefault();if(state.busy)return;const f=new FormData(e.target);const duration=Number(f.get('duration'));const change=Number(f.get('recurring'));state.revision++;message('Manual scenario entered. Please review the amounts before applying.',true);interpretation({status:'ok',interpretation:'Review the amounts and choose how long each recurring change lasts below.',assumptions:change?['Recurring amount is a user-supplied change, already net of the existing category cost.']:[],shock:{income_multiplier:Number(f.get('income'))/100,income_duration_months:duration,scenario_duration_months:duration,household_bills_pct_change:Number(f.get('bills')),one_off_costs:Number(f.get('oneoff'))?[{label:'Immediate expense',amount_dollars:Number(f.get('oneoff'))}]:[],recurring_costs:change?[{label:f.get('label'),monthly_change:change,source:'user_estimate'}]:[]}});};
(async()=>{try{const h=await api('/api/health');$('#health').textContent=h.gemini_enabled?'Connected · local data':'Manual mode · local data';const ids=await api('/api/accounts');$('#accounts').innerHTML=ids.account_ids.map(id=>`<option value="${id}"></option>`).join('');}catch(e){$('#health').textContent='Connection unavailable';}await loadAccount();})();

// A visible tooltip, rather than the browser-dependent SVG title popup.
const balanceTooltip=document.createElement('div');
balanceTooltip.className='balance-tooltip';balanceTooltip.id='balance-tooltip';balanceTooltip.setAttribute('role','tooltip');balanceTooltip.hidden=true;document.body.append(balanceTooltip);
let activeBalancePoint=null;
function showBalancePoint(point){
 if(activeBalancePoint&&activeBalancePoint!==point)activeBalancePoint.removeAttribute('aria-describedby');
 activeBalancePoint=point;point.setAttribute('aria-describedby','balance-tooltip');
 balanceTooltip.textContent=point.dataset.balanceLabel;balanceTooltip.hidden=false;
 const r=point.getBoundingClientRect(),t=balanceTooltip.getBoundingClientRect();
 balanceTooltip.style.left=Math.max(8,Math.min(innerWidth-t.width-8,r.left+r.width/2-t.width/2))+'px';
 balanceTooltip.style.top=Math.max(8,r.top-t.height-10)+'px';
}
function hideBalancePoint(){balanceTooltip.hidden=true;activeBalancePoint?.removeAttribute('aria-describedby');activeBalancePoint=null;}
document.addEventListener('pointerover',e=>{const p=e.target.closest?.('.projection-point');if(p)showBalancePoint(p);});
document.addEventListener('pointerout',e=>{const p=e.target.closest?.('.projection-point');if(p&&!p.contains(e.relatedTarget))hideBalancePoint();});
document.addEventListener('focusin',e=>{const p=e.target.closest?.('.projection-point');if(p)showBalancePoint(p);});
document.addEventListener('focusout',e=>{if(e.target.closest?.('.projection-point'))hideBalancePoint();});
document.addEventListener('click',e=>{const p=e.target.closest?.('.projection-point');if(p)showBalancePoint(p);else hideBalancePoint();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideBalancePoint();if(['Enter',' '].includes(e.key)){const p=e.target.closest?.('.projection-point');if(p){e.preventDefault();showBalancePoint(p);}}});
window.addEventListener('scroll',hideBalancePoint,true);
