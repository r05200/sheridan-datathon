
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
   const title=document.createElement('span');title.className='directory-account-title';title.textContent=`Account ${row.account_id}`;
   const runway=document.createElement('small');runway.textContent=`Official runway: ${row.runway_status==='no_shortfall'?'No shortfall (120+)':`${row.runway_capped?'At least ':''}${row.runway_months} months`}`;
   const negative=document.createElement('small');negative.textContent=`Ever had a day below zero: ${row.past_negative_month?'Yes':'No'}`;
   const loan=document.createElement('small');loan.textContent=row.loan_status?`Loan: ${row.loan_status} · ${row.loan_status_meaning}`:'No loan record';
   const band=document.createElement('small');band.textContent=row.watchlist_band?`Never-negative watchlist: ${row.watchlist_band}`:'Not on never-negative watchlist';
   const details=document.createElement('span');details.className='directory-account-details';details.append(runway,negative,loan,band);
   const arrow=document.createElement('span');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
   button.append(title,details,arrow);button.onclick=()=>openAccount(row.account_id);return button;
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
 document.querySelector('#user-search').addEventListener('input',()=>{visibleCount=60;rows();});
 document.querySelector('#account-filter').addEventListener('change',event=>{visibleCount=60;loadDirectory(event.target.value);});
 loadDirectory();
 document.querySelectorAll('[data-view]').forEach(b=>{if(b.tagName==='BUTTON')b.addEventListener('click',()=>show(b.dataset.view));});
 document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();show('users');});
 document.querySelector('#enter-app').onclick=()=>{if(entering)return;entering=true;document.querySelector('#falling-orange').hidden=false;document.querySelector('#welcome-status').textContent='Opening your financial what-if lab…';const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;setTimeout(()=>{welcome.classList.add('leaving');setTimeout(()=>{welcome.hidden=true;shell.hidden=false;show('users');},reduced?0:350);},reduced?0:1400);};
 new MutationObserver(()=>{if(document.body.dataset.view==='plan'){document.querySelector('#plan-empty').hidden=!!document.querySelector('.action-plans');}}).observe(document.querySelector('#results'),{childList:true});
})();
