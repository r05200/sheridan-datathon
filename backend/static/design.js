
'use strict';
(() => {
 let accounts=[], entering=false, request=0, visibleCount=60;
 const shell=document.querySelector('#app-shell'),welcome=document.querySelector('#welcome');
 const money=value=>value==null?'—':new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(value);
 function show(view){
  if(!['users','customer','stress','plan'].includes(view))view='users';
  document.body.dataset.view=view;
  document.querySelector('#user-database').hidden=view!=='users';
  document.querySelector('#dashboard').hidden=view==='users';
  document.querySelectorAll('.cushion-tabs button').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  document.querySelector('#plan-empty').hidden=!(view==='plan'&&!document.querySelector('.action-plans'));
  if(view==='plan'&&!document.querySelector('.action-plans'))document.querySelector('.workspace').hidden=true;else document.querySelector('.workspace').hidden=false;
  window.scrollTo({top:0,behavior:'instant'});
 }
 function openAccount(id){document.querySelector('#account-id').value=id;document.querySelector('#account-form').requestSubmit();show('customer');}
 function rows(){
  const query=document.querySelector('#user-search').value.trim();
  const matching=accounts.filter(row=>String(row.account_id).includes(query));
  const shown=matching.slice(0,visibleCount);
  document.querySelector('#user-count').textContent=`Showing ${shown.length.toLocaleString()} of ${matching.length.toLocaleString()} matching accounts`;
  document.querySelector('#user-list').replaceChildren(...shown.map(row=>{
   const button=document.createElement('button');button.type='button';button.className='account-card directory-account';
   const identity=document.createElement('span');identity.className='directory-account-identity';
   const title=document.createElement('strong');title.textContent=`${row.account_id}`;
   const loan=document.createElement('small');loan.textContent=row.loan_status?`Loan ${row.loan_status}`:'No loan';
   identity.append(title,loan);
   const runway=document.createElement('span');runway.className='directory-runway';
   runway.textContent=row.runway_status==='no_shortfall'?'No shortfall':`${row.runway_capped?'≥ ':''}${row.runway_months} mo`;
   runway.setAttribute('aria-label',`Official runway: ${row.runway_status==='no_shortfall'?'no monthly shortfall':`${row.runway_months} months`}`);
   const indicators=document.createElement('span');indicators.className='directory-indicators';
   const history=document.createElement('i');history.className=row.past_negative_month?'indicator warning':'indicator';history.textContent=row.past_negative_month?'−':'✓';history.title=row.past_negative_month?'A historical month included a day below zero':'No historical day below zero';
   const watch=document.createElement('i');watch.className=`indicator ${row.watchlist_band==='Priority'?'priority':''}`;watch.textContent=row.watchlist_band==='Priority'?'★':row.watchlist_band==='Watch'?'•':'↗';watch.title=row.watchlist_band?`Never-negative watchlist: ${row.watchlist_band}`:'Not on never-negative watchlist';
   indicators.append(history,watch);
   const arrow=document.createElement('span');arrow.className='directory-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
   button.append(identity,runway,indicators,arrow);button.onclick=()=>openAccount(row.account_id);return button;
  }));
  if(shown.length<matching.length){
   const more=document.createElement('button');more.type='button';more.className='load-more';more.textContent=`Load next ${Math.min(60,matching.length-shown.length)} accounts`;
   more.onclick=()=>{visibleCount+=60;rows();};document.querySelector('#user-list').append(more);
  }
 }
 async function loadDirectory(filter='all'){
  const current=++request;
  document.querySelector('#user-count').textContent='Loading account data…';
  try{
   const response=await fetch(`/api/tangerine/accounts?filter=${encodeURIComponent(filter)}`);
   const data=await response.json();if(!response.ok)throw Error(data.detail||'Could not load accounts.');
   if(current!==request)return;
   accounts=data.accounts;visibleCount=60;rows();
   document.querySelector('#database-count').textContent=`${data.matched_accounts.toLocaleString()} of ${data.total_accounts.toLocaleString()} accounts · as of ${data.as_of}`;
  }catch(error){if(current===request)document.querySelector('#user-count').textContent=error.message;}
 }
 const portfolio=document.createElement('section');
 portfolio.className='portfolio-summary';
 portfolio.setAttribute('aria-labelledby','portfolio-title');
 const portfolioTitle=document.createElement('h2');
 portfolioTitle.id='portfolio-title';
 portfolioTitle.textContent='Portfolio scenario overview';
 const portfolioStatus=document.createElement('p');
 portfolioStatus.className='portfolio-status';
 portfolioStatus.setAttribute('aria-live','polite');
 portfolioStatus.textContent='Loading verified account counts…';
 const portfolioCards=document.createElement('div');
 portfolioCards.className='portfolio-groups';
 portfolio.append(portfolioTitle,portfolioStatus,portfolioCards);
 document.querySelector('.database-content').prepend(portfolio);
 async function loadPortfolio(){
  try{
   const response=await fetch('/api/tangerine/portfolio');
   const data=await response.json();
   if(!response.ok)throw Error(data.detail||'Could not load portfolio scenarios.');
   const baseline=data.baseline,scenarios=data.scenarios;
   const items=[
    ['Baseline','Spending exceeds inflow',baseline.spending_exceeds_income,'Current baseline; not a forecast.'],
    ['Baseline','Under 12 months by formula',baseline.under_twelve_months,'Runway rounded to one decimal before counting.'],
    ['Baseline','Under 6 months by formula',baseline.under_six_months,'Includes accounts with a depleted challenge buffer.'],
    ['Baseline','Six months with zero income',baseline.can_cover_six_months_at_zero_income,'Buffer covers six months of typical spending.'],
    ['Illustrative twists','55% income: under 6 months',scenarios.income_at_55_percent.under_six_months,'Income-retention scenario; not an EI eligibility estimate.'],
    ['Illustrative twists','55% income + bills up 15%',scenarios.income_at_55_percent_and_bills_up_15_percent.under_six_months,`${scenarios.income_at_55_percent_and_bills_up_15_percent.additional_under_six_vs_55_percent_income.toLocaleString()} more than the 55%-income scenario alone.`],
    ['Illustrative twists','Buffers at or below zero after repair',scenarios.one_month_spending_repair.buffers_depleted_after_scenario,`${scenarios.one_month_spending_repair.newly_depleted_buffers.toLocaleString()} newly depleted; others were already at or below zero.`],
    ['Illustrative twists','After repair: under 6 months',scenarios.one_month_spending_repair.under_six_months,'One-off cost equals a month of typical spending.'],
   ];
   const groups=new Map();
   for(const [group,label,count,note] of items){
    if(!groups.has(group)){
     const section=document.createElement('section');
     section.className='portfolio-group';
     const heading=document.createElement('h3');
     heading.textContent=group;
     const cards=document.createElement('div');
     cards.className='portfolio-cards';
     section.append(heading,cards);
     groups.set(group,cards);
     portfolioCards.append(section);
    }
    const card=document.createElement('article');
    const heading=document.createElement('h4');
    heading.textContent=label;
    const value=document.createElement('strong');
    value.textContent=Number(count).toLocaleString();
    const track=document.createElement('span');
    track.className='portfolio-track';
    const fill=document.createElement('i');
    fill.style.width=`${Math.min(100,100*Number(count)/data.total_accounts)}%`;
    track.setAttribute('role','img');
    track.setAttribute('aria-label',`${Number(count).toLocaleString()} of ${data.total_accounts.toLocaleString()} accounts`);
    track.append(fill);
    const detail=document.createElement('small');
    detail.textContent=note;
    card.append(heading,value,track,detail);
    groups.get(group).append(card);
   }
   portfolioStatus.textContent=`${data.total_accounts.toLocaleString()} accounts · latest history ${data.as_of}`;
  }catch(error){
   portfolioStatus.textContent=`Portfolio summary unavailable: ${error.message}`;
   portfolioCards.replaceChildren();
  }
 }
 document.querySelector('#user-search').addEventListener('input',()=>{visibleCount=60;rows();});
 document.querySelector('#account-filter').addEventListener('change',event=>{visibleCount=60;loadDirectory(event.target.value);});
 loadDirectory();
 loadPortfolio();
 document.querySelectorAll('[data-view]').forEach(b=>{if(b.tagName==='BUTTON')b.addEventListener('click',()=>show(b.dataset.view));});
 document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();show('users');});
 document.querySelector('#enter-app').onclick=()=>{if(entering)return;entering=true;document.querySelector('#falling-orange').hidden=false;document.querySelector('#welcome-status').textContent='Opening your financial what-if lab…';const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;setTimeout(()=>{welcome.classList.add('leaving');setTimeout(()=>{welcome.hidden=true;shell.hidden=false;show('users');},reduced?0:350);},reduced?0:1400);};
 new MutationObserver(()=>{if(document.body.dataset.view==='plan'){document.querySelector('#plan-empty').hidden=!!document.querySelector('.action-plans');}}).observe(document.querySelector('#results'),{childList:true});
})();
