const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash = x => x == null ? '—' : new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(x);
const state = {account:20134, baseline:null, plan:null, pending:null, amounts:{}, duration:null, incomePct:null, overlap:false, busy:false, revision:0, recentQueries:[], appliedShock:null, planning:{}};
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
function renderBaseline(){const b=state.baseline,p=state.plan;const base=p?.baseline||{income:b.income,spending:b.spending,buffer:b.buffer,runway_months:b.buffer<=0?0:b.spending<=b.income?'no_shortfall':Math.min(b.buffer/(b.spending-b.income),120).toFixed(1),runway_capped:b.spending>b.income&&b.buffer/(b.spending-b.income)>120};const cards=[['Monthly inflows',cash(b.income),'Median recorded money in'],['Monthly spending',cash(b.spending),'Median recorded money out'],['Household bills',cash(b.household_bills),'Typical monthly spending recorded as household bills'],['Fixed costs',cash(b.fixed_costs),'Median of monthly bills + insurance + loans'],['Savings buffer',cash(b.buffer),'Mean balance over last six months'],['Baseline runway',runway(base),base.runway_capped?'Capped at 120 months':'Under typical conditions']];$('#metrics').innerHTML=cards.map((c,i)=>`<div class="metric ${i===4?'highlight':''}"><label>${c[0]}</label><strong>${c[1]}</strong><small>${c[2]}</small></div>`).join('');$('#account-meta').textContent=`${b.months_of_history} observed months · Active loan payment ${cash(b.loan_payment)}/month`;}
function renderResults(){const p=state.plan,b=state.baseline;$('.results-panel').classList.toggle('awaiting-scenario',!p);if(!p){$('#results').innerHTML='<div class="empty scenario-empty"><h3>Apply a stress test to see the results</h3><p>Describe a change, review the scenario, then select “Apply this scenario” to see its impact here.</p></div>'+`<details class="data"><summary>Explore the full account baseline</summary><pre>${esc(JSON.stringify(b,null,2))}</pre></details>`;return;}
const a=p.after_shock;const rows=[['Monthly inflows',cash(p.baseline.income),cash(a.income)],['Monthly spending',cash(p.baseline.spending),cash(a.spending)],['Buffer after immediate costs',cash(p.baseline.buffer),cash(a.buffer)],['Monthly shortfall',cash(Math.max(b.spending-b.income,0)),cash(a.monthly_gap)],['Runway',runway(p.baseline),runway(a)],['Immediate expense','—',cash(a.one_off_costs||0)]];
let html=`<table class="comparison"><thead><tr><th>Account ${state.account}</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table>`;
const d=p.duration_assessment;if(d){html+=`<div class="outcome ${d.covers_duration?'':'danger'}"><h3>${d.covers_duration?'Covered':'Funding gap'} over ${d.months} months</h3><p>${esc(d.assumption)}</p><div class="mini-grid"><div class="mini"><small>Required starting buffer</small><strong>${cash(d.required_starting_buffer)}</strong></div><div class="mini"><small>Additional buffer needed</small><strong>${cash(d.additional_buffer_needed)}</strong></div></div></div>`;html+=chart(p);}
html+=`<div class="mini-grid"><div class="mini"><small>Required monthly spending reduction</small><strong>${cash(p.backup_plan.monthly_cut_needed)}</strong></div><div class="mini"><small>Immediate funding needed</small><strong>${cash(p.backup_plan.upfront_funding_needed)}</strong></div><div class="mini"><small>Emergency-fund target</small><strong>${cash(p.goal_plan.target_amount)}</strong></div><div class="mini"><small>Time to goal at baseline surplus</small><strong>${p.goal_plan.months_to_goal===null?'Not reachable':p.goal_plan.months_to_goal+' months'}</strong></div></div>${renderActionPlan(p)}<div id="explanation" class="explanation"><p>Preparing the explanation…</p></div><details class="data"><summary>Inspect all calculated values and account data</summary><pre>${esc(JSON.stringify({account:b,plan:p},null,2))}</pre></details><p style="font-size:10px;color:var(--muted)">Amounts are displayed as whole dollars. Estimates are scenario inputs, not observed category budgets.</p>`;$('#results').innerHTML=html;bindPlanning();}
function estimateNote(){
 const s=state.appliedShock,p=state.planning;
 const hasEstimate=s && (s.one_off_costs?.length || s.recurring_costs?.length || (s.income_multiplier!=null&&s.income_multiplier!==1) || s.household_bills_pct_change || s.spending_pct_change || p.monthly_contribution!=null || p.confirmed_monthly_cut || p.confirmed_extra_income || p.confirmed_upfront_funds);
 return hasEstimate?'<p class="estimate-note">Plans and calculations are based on your estimates alongside recorded account data.</p>':'';
}
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
 <ol class="plan-steps">${g.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></article>
 <article class="plan-card"><p class="eyebrow">IF THE SHOCK HITS</p><h3>Your backup plan</h3><p class="plan-status">${esc(backupStatus[b.status])}</p>
 <div class="form-grid"><label>Confirmed spending reduction ($/month)<input name="confirmed_monthly_cut" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_monthly_cut}" required></label><label>Confirmed extra income ($/month)<input name="confirmed_extra_income" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_extra_income}" required></label><label>Confirmed upfront funds ($)<input name="confirmed_upfront_funds" type="number" min="0" max="1000000" step="0.01" value="${b.confirmed_upfront_funds}" required></label></div>
 <dl class="plan-numbers"><div><dt>Immediate funding still needed</dt><dd>${preciseCash(b.remaining_immediate_funding_gap)}</dd></div><div><dt>Monthly income after your actions</dt><dd>${preciseCash(b.income_after_actions)}</dd></div><div><dt>Monthly spending after your actions</dt><dd>${preciseCash(b.spending_after_actions)}</dd></div><div><dt>Remaining monthly shortfall</dt><dd>${preciseCash(b.monthly_gap_after_actions)}</dd></div><div><dt>Further monthly improvement needed</dt><dd>${preciseCash(b.additional_monthly_improvement_needed)}</dd></div><div><dt>Monthly spending ceiling ${b.duration_months?'for '+b.duration_months+' months':'to stop drawing down savings'}</dt><dd>${preciseCash(b.maximum_monthly_spending_for_horizon)}</dd></div>${b.duration_months?`<div><dt>Projected end balance after actions</dt><dd>${preciseCash(b.ending_buffer_after_actions)}</dd></div><div><dt>Additional buffer without further monthly changes</dt><dd>${preciseCash(b.additional_buffer_for_horizon)}</dd></div>`:''}</dl>
 <ol class="plan-steps">${b.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></article>
 <p id="planning-error" class="notice error" role="alert" hidden></p><button type="submit">Recalculate my plans ↗</button></form></section>`;
}
function bindPlanning(){
 const form=$('#planning-form');if(!form)return;
 form.onsubmit=async e=>{
  e.preventDefault();if(state.busy||!state.appliedShock)return;
  const fields=new FormData(form),settings={};
  for(const [k,v] of fields)settings[k]=v===''?null:Number(v);
  busy(true);
  try{const p=await api('/api/plan',{account_id:state.account,shock:state.appliedShock,planning:settings});state.planning=settings;state.plan=p;renderResults();
   const t=await api('/api/explain',p);$('#explanation').innerHTML=`<h3>What this means</h3><p>${esc(t.summary)}</p><h3>Your goal</h3><p>${esc(t.goal_plan_text)}</p><h3>Contingency plan</h3><p>${esc(t.backup_plan_text)}</p>${t.caveat?`<p class="warning">${esc(t.caveat)}</p>`:''}${estimateNote()}`;
  }catch(error){const box=$('#planning-error');box.hidden=false;box.textContent=error.message;}finally{busy(false);}
 };
}
function chart(p){
 const n=p.duration_assessment.months,a=p.after_shock;
 const net=(p.duration_assessment.ending_buffer-a.buffer)/n,values=Array.from({length:n+1},(_,i)=>({month:i,value:a.buffer+i*net}));
 const end=values[n].value,top=Math.max(1,...values.map(d=>d.value)),bottom=Math.min(0,...values.map(d=>d.value));
 const pad=(top-bottom)*.14,hi=top+pad,lo=bottom<0?bottom-pad:0;
 const left=76,right=568,up=34,down=242,x=m=>left+m/n*(right-left),y=v=>up+(hi-v)/(hi-lo)*(down-up);
 const compact=v=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',notation:'compact',maximumFractionDigits:1}).format(v);
 const cross=net!==0?-a.buffer/net:null,exhausted=a.buffer<=0?0:net<0&&cross!==null&&cross<=n?cross:null;
 const points=[...values];if(cross!==null&&cross>0&&cross<n&&!Number.isInteger(cross))points.push({month:cross,value:0});points.sort((a,b)=>a.month-b.month);
 const path=pts=>pts.map((d,i)=>`${i?'L':'M'}${x(d.month).toFixed(2)},${y(d.value).toFixed(2)}`).join(' ');
 const positive=points.filter(d=>d.value>=0),negative=points.filter(d=>d.value<=0);
 const area=pts=>pts.length>1?`${path(pts)} L${x(pts.at(-1).month)},${y(0)} L${x(pts[0].month)},${y(0)} Z`:'';
 const ticks=n<=12?Array.from({length:n+1},(_,i)=>i):Array.from(new Set([0,...Array.from({length:6},(_,i)=>Math.round(n*(i+1)/6))]));
 const grid=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4).filter(v=>Math.abs(v)>(hi-lo)*.03).map(v=>`<g><line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="projection-grid"/><text x="${left-12}" y="${y(v)+4}" text-anchor="end">${compact(v)}</text></g>`).join('');
 const status=exhausted!==null?`Savings run out ${exhausted===0?'immediately':'around month '+exhausted.toFixed(1)}`:`Buffer lasts through month ${n}`;
 return `<section class="chart projection"><div class="projection-heading"><div><h3>Your savings over time</h3><p>What happens if this scenario continues for ${n} months?</p></div><span class="projection-pill ${exhausted!==null?'shortfall':''}">${exhausted!==null?'Funding gap':'Covered'}</span></div>
 <div class="projection-stats"><div><small>After immediate costs</small><strong>${cash(a.buffer)}</strong></div><span aria-hidden="true">→</span><div><small>${end<0?'Unfunded by':'Remaining at'} month ${n}</small><strong class="${end<0?'projection-loss':''}">${cash(Math.abs(end))}</strong></div></div>
 <svg viewBox="0 0 600 296" role="img" aria-label="Savings projection: starts at ${cash(a.buffer)}, ends at ${cash(end)} after ${n} months. ${esc(status)}."><defs><linearGradient id="buffer-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f58220" stop-opacity=".24"/><stop offset="100%" stop-color="#f58220" stop-opacity=".02"/></linearGradient></defs>
 ${grid}<path d="${area(positive)}" fill="url(#buffer-fill)"/><path d="${area(negative)}" fill="#c8344b" fill-opacity=".08"/>
 <line x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}" class="projection-zero"/><text x="${left-12}" y="${y(0)+4}" text-anchor="end">$0</text>
 <path d="${path(positive)}" class="projection-line"/><path d="${path(negative)}" class="projection-line negative"/>
 ${values.map(d=>{const label=`${d.month===0?'Now':'Month '+d.month} · ${cash(Math.abs(d.value))}${d.value<0?' unfunded':' remaining'}`;return `<g class="projection-point" tabindex="0" role="button" aria-label="${esc(label)}" data-balance-label="${esc(label)}"><circle cx="${x(d.month)}" cy="${y(d.value)}" r="15" fill="transparent"/><circle cx="${x(d.month)}" cy="${y(d.value)}" r="${d.month===0||d.month===n?5:3}" fill="${d.value<0?'#c8344b':'#f58220'}" stroke="white" stroke-width="2"/></g>`;}).join('')}

 ${exhausted!==null&&exhausted>0?`<circle cx="${x(exhausted)}" cy="${y(0)}" r="6" fill="white" stroke="#c8344b" stroke-width="2"><title>Savings exhausted around month ${exhausted.toFixed(1)}</title></circle>`:''}
 ${ticks.map(m=>`<text x="${x(m)}" y="268" text-anchor="middle">${m===0?'Now':'Mo '+m}</text>`).join('')}<text x="322" y="291" text-anchor="middle">Months after shock</text></svg>
 <div class="projection-caption ${exhausted!==null?'projection-loss':''}"><span class="projection-dot"></span>${esc(status)}</div><p class="projection-note">${end<0?'The dashed red line shows spending that savings cannot cover. ':''}Projection uses the scenario’s monthly income and spending, held constant. Hover, tap, or focus a point for its balance.</p></section>`;
}
async function loadAccount(){const id=Number($('#account-id').value);busy(true);$('#page-error').hidden=true;try{const b=await api(`/api/accounts/${id}/baseline`);state.account=id;$('#selected-account').textContent=id;loadRecentQueries();state.baseline=b;state.plan=null;state.appliedShock=null;state.planning={};state.pending=null;state.amounts={};state.duration=null;state.incomePct=null;state.overlap=false;state.revision++;$('#messages').replaceChildren();message('What would you like to stress-test? I’ll ask for an estimate if the account data doesn’t identify a cost.');$('#result-label').textContent='No stress test applied yet.';renderBaseline();renderResults();}catch(e){$('#page-error').hidden=false;$('#page-error').textContent=e.message;}finally{busy(false);}}
function interpretation(result){const revision=state.revision;state.pending=result;const box=document.createElement('div');box.className='message';let html=`<p><strong>${result.status==='needs_input'?'A little more detail':'Review your scenario'}</strong></p><p>${esc(result.interpretation||'Please review the changes and assumptions below.')}</p>`;if(result.assumptions?.length)html+=`<ul>${result.assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`;
if(result.status==='needs_input'){const rephrase=result.questions.some(q=>q.kind==='rephrase');html+='<form class="clarify">';for(const q of result.questions){if(q.kind==='monthly_cost')html+=`<label>${esc(q.question)}<input type="number" name="amount_${esc(q.key)}" min="0" max="1000000" step="0.01" required placeholder="Monthly amount in CAD"></label>`;else if(q.kind==='income_percentage')html+=`<label>${esc(q.question)}<input type="number" name="incomePct" min="0" max="150" step="0.1" required placeholder="0 for no income, 55 for 55%"></label>`;else if(q.kind==='duration')html+=`<label>${esc(q.question)}<input type="number" name="duration" min="1" max="60" step="1" required></label>`;else if(q.kind==='confirmation')html+=`<label class="check"><input type="checkbox" name="overlap" required> ${esc(q.question)}</label>`;else html+=`<p class="error">Please revise your message: ${esc(q.question)}</p>`;}if(!rephrase)html+='<button type="submit">Use these values →</button>';html+='</form>';box.innerHTML=html;box.querySelector('form').onsubmit=async e=>{e.preventDefault();if(state.busy)return;if(revision!==state.revision){message("This interpretation has been replaced. Use the latest scenario.");return;}const fd=new FormData(e.target);for(const [k,v]of fd){if(k.startsWith('amount_'))state.amounts[k.slice(7)]=Number(v);if(k==='duration')state.duration=Number(v);if(k==='incomePct')state.incomePct=Number(v);if(k==='overlap')state.overlap=true;}busy(true);try{const r=await api('/api/resolve-shock',{account_id:state.account,draft:result.draft,category_amounts:state.amounts,duration_months:state.duration,income_replacement_pct:state.incomePct,overlap_acknowledged:state.overlap});box.querySelector('button')?.remove();interpretation(r);}catch(e){message(e.message);}finally{busy(false);}};
}else{html+=`<details><summary>See exact scenario inputs</summary><pre>${esc(JSON.stringify(result.shock,null,2))}</pre></details><button type="button">Apply this scenario ↗</button>`;box.innerHTML=html;box.querySelector('button').onclick=async()=>{if(state.busy)return;if(revision!==state.revision){message("This interpretation has been replaced. Use the latest scenario.");return;}busy(true);try{await apply(result.shock);box.querySelector('button').remove();}catch(e){message(e.message);}finally{busy(false);}};}
$('#messages').append(box);box.scrollIntoView({block:'nearest',behavior:'smooth'});}
async function apply(shock){const choices={target_months:state.planning.target_months??3,deadline_months:state.planning.deadline_months??12,monthly_contribution:state.planning.monthly_contribution??null};const p=await api('/api/plan',{account_id:state.account,shock,planning:choices});state.planning=choices;state.appliedShock=shock;state.plan=p;$('#result-label').textContent='Baseline versus your applied scenario.';renderBaseline();renderResults();message('Scenario applied. The comparison and funding plan are ready.');try{const t=await api('/api/explain',p);$('#explanation').innerHTML=`<h3>What this means</h3><p>${esc(t.summary)}</p><h3>Your goal</h3><p>${esc(t.goal_plan_text)}</p><h3>Contingency plan</h3><p>${esc(t.backup_plan_text)}</p>${t.caveat?`<p class="warning">${esc(t.caveat)}</p>`:''}${estimateNote()}`;}catch(e){$('#explanation').textContent='Calculations are available. Explanation unavailable: '+e.message;}}
$('#account-form').onsubmit=e=>{e.preventDefault();if(!state.busy)loadAccount();};
$('#chat-form').onsubmit=async e=>{e.preventDefault();if(state.busy||!state.baseline)return;const text=$('#query').value.trim();if(!text)return;state.revision++;rememberQuery(text);message(text,true);$('#query').value='';state.amounts={};state.duration=null;state.incomePct=null;state.overlap=false;busy(true);try{const r=await api('/api/parse-shock',{account_id:state.account,text});if(['ok','needs_input'].includes(r.status))interpretation(r);else{message(r.message||'No usable change was found. Try a more specific scenario.');if(r.status==='error')$('.manual').open=true;}}catch(e){message(e.message);}finally{busy(false);}};
$('#manual-form').onsubmit=e=>{e.preventDefault();if(state.busy)return;const f=new FormData(e.target);const duration=Number(f.get('duration'));const change=Number(f.get('recurring'));state.revision++;message('Manual scenario entered. Please review the amounts before applying.',true);interpretation({status:'ok',interpretation:'All changes are held constant during the selected assessment window.',assumptions:change?['Recurring amount is a user-supplied change, already net of the existing category cost.']:[],shock:{income_multiplier:Number(f.get('income'))/100,income_duration_months:duration,scenario_duration_months:duration,household_bills_pct_change:Number(f.get('bills')),one_off_costs:Number(f.get('oneoff'))?[{label:'Immediate expense',amount_dollars:Number(f.get('oneoff'))}]:[],recurring_costs:change?[{label:f.get('label'),monthly_change:change,source:'user_estimate'}]:[]}});};
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
