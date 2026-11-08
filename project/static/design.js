
'use strict';
(() => {
 let entering=false, page=1, request=0, searchTimer;
 const shell=document.querySelector('#app-shell'),welcome=document.querySelector('#welcome');
 function openAccount(id){document.querySelector('#account-id').value=id;document.querySelector('#account-form').requestSubmit();show('customer');}
 function show(view){
  if(!['users','customer','stress','plan'].includes(view))view='users';
  document.body.dataset.view=view;
  const hero=document.querySelector('.intro');
  hero.querySelector('.eyebrow').textContent=view==='plan'?'YOUR GOAL & BACKUP PLAN':'YOUR FINANCIAL WHAT-IF LAB';
  hero.querySelector('h1').innerHTML=view==='plan'?'Build your safety cushion.':'Your money,<br>a little clearer.';
  hero.querySelector('.sub').textContent=view==='plan'?'Choose your goal. Test your backup budget. See what it takes.':'Explore an account. Apply a shock. Find the buffer you need.';
  document.querySelector('#user-database').hidden=view!=='users';
  document.querySelector('#dashboard').hidden=view==='users';
  document.querySelectorAll('.cushion-tabs button').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  document.querySelector('#plan-empty').hidden=!(view==='plan'&&!document.querySelector('.action-plans'));
  if(view==='plan'&&!document.querySelector('.action-plans'))document.querySelector('.workspace').hidden=true;else document.querySelector('.workspace').hidden=false;
  window.scrollTo({top:0,behavior:'instant'});
 }
 async function rows(){
  const revision=++request,q=document.querySelector('#user-search').value.trim();
  const list=document.querySelector('#user-list'),previous=document.querySelector('#previous-accounts'),next=document.querySelector('#next-accounts');
  list.setAttribute('aria-busy','true');previous.disabled=true;next.disabled=true;document.querySelector('#user-count').textContent='Loading accounts…';
  try{
   const response=await fetch(`/api/tangerine/accounts?page=${page}&search=${encodeURIComponent(q)}&filter=${encodeURIComponent(document.querySelector('#account-filter').value)}`);
   if(!response.ok)throw Error('Could not load accounts. Try searching again.');
   const data=await response.json();if(revision!==request)return;
   document.querySelector('#database-count').textContent=`${data.total.toLocaleString()} accounts`;
   const first=data.accounts.length?(page-1)*30+1:0,last=(page-1)*30+data.accounts.length;
   document.querySelector('#user-count').textContent=`${first}–${data.accounts.length?last:0} of ${data.total.toLocaleString()}${q?' matching':''} accounts`;
   document.querySelector('#account-page').textContent=`Page ${page} of ${Math.max(1,Math.ceil(data.total/30))}`;
   list.replaceChildren(...data.accounts.map(row=>{
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
   if(!data.accounts.length)list.textContent='No accounts match that ID.';
   previous.disabled=!data.has_previous;next.disabled=!data.has_next;
  }catch(error){if(revision===request){document.querySelector('#user-count').textContent=error.message;list.replaceChildren();previous.disabled=page<=1;}}
  finally{if(revision===request)list.setAttribute('aria-busy','false');}
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
   portfolioStatus.textContent=`${data.total_accounts.toLocaleString()} accounts · history snapshot ${data.as_of} · scenario counts use current baseline data`;
  }catch(error){
   portfolioStatus.textContent=`Portfolio summary unavailable: ${error.message}`;
   portfolioCards.replaceChildren();
  }
 }
 document.querySelector('#account-filter').addEventListener('change',()=>{clearTimeout(searchTimer);page=1;rows();});
 loadPortfolio();
 document.querySelector('#user-search').addEventListener('input',()=>{clearTimeout(searchTimer);request++;page=1;searchTimer=setTimeout(rows,200);});
 document.querySelector('#previous-accounts').onclick=()=>{page=Math.max(1,page-1);rows();};
 document.querySelector('#next-accounts').onclick=()=>{page++;rows();};
 rows();
 document.querySelectorAll('[data-view]').forEach(b=>{if(b.tagName==='BUTTON')b.addEventListener('click',()=>show(b.dataset.view));});
 document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();show('users');});
 const falling=document.querySelector('#falling-orange'),mark=document.querySelector('.welcome-mark');
 document.querySelector('#enter-app').onclick=async()=>{
  if(entering)return;entering=true;document.querySelector('#enter-app').setAttribute('aria-disabled','true');
  document.querySelector('#welcome-status').textContent='Cushioning the unexpected…';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduced){
   mark.classList.add('dropping');
   await new Promise(resolve=>{let done=false;const finish=e=>{if(e&&e.target!==falling)return;if(done)return;done=true;falling.removeEventListener('animationend',finish);resolve();};falling.addEventListener('animationend',finish);setTimeout(finish,1900);});
  }
  mark.classList.add('landed');document.querySelector('#welcome-status').textContent='Ready for what comes next.';
  setTimeout(()=>{welcome.classList.add('leaving');setTimeout(()=>{welcome.hidden=true;shell.hidden=false;show('users');},reduced?0:350);},reduced?150:1200);
 };

 new MutationObserver(()=>{if(document.body.dataset.view==='plan'){document.querySelector('#plan-empty').hidden=!!document.querySelector('.action-plans');}}).observe(document.querySelector('#results'),{childList:true});
})();
