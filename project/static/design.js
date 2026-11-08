
'use strict';
(() => {
 let entering=false, page=1, request=0, searchTimer;
 const shell=document.querySelector('#app-shell'),welcome=document.querySelector('#welcome');
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
   const response=await fetch(`/api/account-directory?page=${page}&search=${encodeURIComponent(q)}`);
   if(!response.ok)throw Error('Could not load accounts. Try searching again.');
   const data=await response.json();if(revision!==request)return;
   document.querySelector('#database-count').textContent=`${data.total.toLocaleString()} accounts`;
   const first=data.accounts.length?(page-1)*30+1:0,last=(page-1)*30+data.accounts.length;
   document.querySelector('#user-count').textContent=`${first}–${data.accounts.length?last:0} of ${data.total.toLocaleString()}${q?' matching':''} accounts`;
   document.querySelector('#account-page').textContent=`Page ${page} of ${Math.max(1,Math.ceil(data.total/30))}`;
   const labels={healthy:'Healthy',watch:'Watch',at_risk:'At risk'},definitions={healthy:'Buffer covers at least 3 months of spending and monthly cash flow is nonnegative.',watch:'Buffer covers at least 1 month of spending; the healthy criteria are not met.',at_risk:'Buffer covers less than 1 month of normal spending.'};
   list.replaceChildren(...data.accounts.map(account=>{
    const b=document.createElement('button');b.className='account-card';
    const content=document.createElement('span');content.className='account-card-content';
    const title=document.createElement('strong');title.textContent=`Account ${account.account_id}`;
    const badge=document.createElement('span');badge.className=`account-health ${account.health}`;badge.textContent=labels[account.health];badge.title=definitions[account.health];
    const stat=document.createElement('small');stat.textContent=`Savings buffer ${new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(account.buffer)}`;
    content.append(title,badge,stat);const arrow=document.createElement('span');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');b.append(content,arrow);
    b.onclick=()=>{document.querySelector('#account-id').value=account.account_id;document.querySelector('#account-form').requestSubmit();show('customer');};return b;
   }));
   if(!data.accounts.length)list.textContent='No accounts match that ID.';
   previous.disabled=!data.has_previous;next.disabled=!data.has_next;
  }catch(error){if(revision===request){document.querySelector('#user-count').textContent=error.message;list.replaceChildren();previous.disabled=page<=1;}}
  finally{if(revision===request)list.setAttribute('aria-busy','false');}
 }
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
