
'use strict';
(() => {
 let ids=[], entering=false;
 const shell=document.querySelector('#app-shell'),welcome=document.querySelector('#welcome');
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
 function rows(){const q=document.querySelector('#user-search').value.trim();const matching=ids.filter(id=>String(id).includes(q));document.querySelector('#user-count').textContent=`${matching.length.toLocaleString()} matching accounts${matching.length>60?' · first 60 shown; search to narrow the list':''}`;document.querySelector('#database-count').textContent=`${ids.length.toLocaleString()} accounts · anonymized challenge data`;document.querySelector('#user-list').replaceChildren(...matching.slice(0,60).map(id=>{const b=document.createElement('button');b.className='account-card';b.innerHTML=`<span>Account ${id}<small>Open money snapshot</small></span><span aria-hidden="true">↗</span>`;b.onclick=()=>{document.querySelector('#account-id').value=id;document.querySelector('#account-form').requestSubmit();show('customer');};return b;}));}
 const options=document.querySelector('#accounts');new MutationObserver(()=>{ids=Array.from(options.options,o=>Number(o.value));rows();}).observe(options,{childList:true});ids=Array.from(options.options,o=>Number(o.value));rows();
 document.querySelector('#user-search').addEventListener('input',rows);
 document.querySelectorAll('[data-view]').forEach(b=>{if(b.tagName==='BUTTON')b.addEventListener('click',()=>show(b.dataset.view));});
 document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();show('users');});
 document.querySelector('#enter-app').onclick=()=>{if(entering)return;entering=true;document.querySelector('#falling-orange').hidden=false;document.querySelector('#welcome-status').textContent='Opening your financial what-if lab…';const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;setTimeout(()=>{welcome.classList.add('leaving');setTimeout(()=>{welcome.hidden=true;shell.hidden=false;show('users');},reduced?0:350);},reduced?0:1400);};
 new MutationObserver(()=>{if(document.body.dataset.view==='plan'){document.querySelector('#plan-empty').hidden=!!document.querySelector('.action-plans');}}).observe(document.querySelector('#results'),{childList:true});
})();
