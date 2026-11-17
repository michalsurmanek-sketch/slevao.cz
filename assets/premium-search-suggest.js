(()=>{'use strict';
const popular=['mléko','máslo','káva','vejce','banány','kuřecí maso','mouka','cukr'];
const categories=['Potraviny','Drogerie','Nápoje','Ovoce a zelenina','Maso','Pečivo','Domácnost'];
const categoryIcons={'Potraviny':'🛒','Drogerie':'🧴','Nápoje':'🥤','Ovoce a zelenina':'🍌','Maso':'🥩','Pečivo':'🥐','Domácnost':'🏠'};
const productIcons={'mléko':'🥛','máslo':'🧈','káva':'☕','vejce':'🥚','banány':'🍌','kuřecí maso':'🍗','mouka':'🌾','cukr':'🍬'};
const normalize=s=>s.toLocaleLowerCase('cs').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const popularKey='slevao.search.popular.v1';
function readPopular(){
 try{const saved=JSON.parse(localStorage.getItem(popularKey));if(Array.isArray(saved))return [...new Map(saved.filter(x=>typeof x==='string').map(x=>x.trim().slice(0,60)).filter(Boolean).map(x=>[normalize(x),x])).values()].slice(0,30)}catch{}
 return [...popular];
}
function setup(input){
 if(input.dataset.premiumSuggest==='1')return;
 input.dataset.premiumSuggest='1';
 const holder=input.closest('form')||input.parentElement;
 if(!holder)return;
 holder.classList.add('premiumSuggestHost');
 const panel=document.createElement('div');panel.className='premiumSuggestPanel';panel.hidden=true;
 let editing=false,draft=[],editError='';
 panel.setAttribute('role','region');panel.setAttribute('aria-label','Návrhy vyhledávání');
 holder.appendChild(panel);
 input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
 const search=(value)=>{const q=value.trim();if(!q)return;location.href='index.html?q='+encodeURIComponent(q)+'#dealsSection'};
 function positionPanel(){
 if(panel.hidden)return;
 if(window.innerWidth<=800){
 const top=Math.round(input.getBoundingClientRect().bottom+6);
 const viewport=window.visualViewport;
 const bottom=viewport?viewport.offsetTop+viewport.height:window.innerHeight;
 panel.style.setProperty('--premium-suggest-top',top+'px');
 panel.style.setProperty('--premium-suggest-height',Math.max(0,Math.min(390,bottom-top-10))+'px');
 }else{
 panel.style.removeProperty('--premium-suggest-top');
 panel.style.removeProperty('--premium-suggest-height');
 }
 }
 window.addEventListener('resize',positionPanel);
 window.addEventListener('scroll',positionPanel,{passive:true});
 window.visualViewport?.addEventListener('resize',positionPanel);
 window.visualViewport?.addEventListener('scroll',positionPanel);
 function editButton(action,label,extra=''){
 return '<button type="button" class="premiumSuggestEditButton" data-popular-action="'+action+'" '+extra+'>'+label+'</button>';
 }
 function renderEditor(){
 let html='<div class="premiumSuggestHeading"><span>Upravit často hledané</span></div><p class="premiumSuggestEditHint">Šipkami změňte pořadí. Položky můžete přidat i odebrat.</p>';
 draft.forEach((word,i)=>{html+='<div class="premiumSuggestEditRow"><strong>'+escape(word)+'</strong>'+editButton('up','↑','data-index="'+i+'" aria-label="Posunout '+escape(word)+' nahoru"'+(i===0?' disabled':''))+editButton('down','↓','data-index="'+i+'" aria-label="Posunout '+escape(word)+' dolů"'+(i===draft.length-1?' disabled':''))+editButton('remove','×','data-index="'+i+'" aria-label="Odebrat '+escape(word)+'"')+'</div>'});
 html+='<div class="premiumSuggestEditAdd"><input type="text" class="premiumSuggestEditInput" maxlength="60" placeholder="Přidat položku, např. jogurt" aria-label="Nová často hledaná položka">'+editButton('add','Přidat')+'</div><p class="premiumSuggestEditError" role="status">'+escape(editError)+'</p><div class="premiumSuggestEditActions">'+editButton('cancel','Zrušit')+editButton('save','Uložit')+'</div>';
 panel.innerHTML=html;panel.hidden=false;positionPanel();input.setAttribute('aria-expanded','true');
 }
 function addPopular(){
 const field=panel.querySelector('.premiumSuggestEditInput'),word=field.value.trim();
 if(!word){editError='Napište název položky.';}
 else if(draft.some(x=>normalize(x)===normalize(word))){editError='Tato položka už v seznamu je.';}
 else if(draft.length>=30){editError='Můžete uložit nejvýše 30 položek.';}
 else{draft.push(word.slice(0,60));editError='';}
 renderEditor();panel.querySelector('.premiumSuggestEditInput')?.focus({preventScroll:true});
 }
 function render(){
 if(editing){renderEditor();return;}
 const currentPopular=readPopular();
 const value=input.value.trim(),norm=normalize(value);
 const words=(value?currentPopular.filter(x=>normalize(x).includes(norm)):currentPopular);
 const cats=(value?categories.filter(x=>normalize(x).includes(norm)):categories).slice(0,4);
 let html='<div class="premiumSuggestHeading"><span>✦ Chytré vyhledávání</span><small>Produkty · Kategorie · Akce</small></div>';
 if(value)html+='<button type="button" class="premiumSuggestRow" data-query="'+escape(value)+'"><span class="premiumSuggestGlyph">⌕</span><span><strong>Hledat „'+escape(value)+'“</strong><small>Zobrazit odpovídající nabídky</small></span><span>›</span></button>';
 if(!value)html+='<div class="premiumSuggestCaption premiumSuggestCaptionEditable"><span>Často hledané</span>'+editButton('edit','✎ Upravit','aria-label="Upravit často hledané"')+'</div>';
 if(words.length){if(value)html+='<div class="premiumSuggestCaption">Podobné hledání</div>';for(const word of words)html+='<button type="button" class="premiumSuggestRow" data-query="'+escape(word)+'"><span class="premiumSuggestGlyph premiumSuggestProductIcon" aria-hidden="true">'+(productIcons[word]||'⌕')+'</span><span><strong>'+escape(word)+'</strong><small>Vyhledat v nabídkách</small></span><span>›</span></button>';}
 if(cats.length){html+='<div class="premiumSuggestCaption">Kategorie</div><div class="premiumSuggestChips">';for(const cat of cats)html+='<button type="button" data-query="'+escape(cat)+'"><span class="premiumSuggestCategoryIcon" aria-hidden="true">'+(categoryIcons[cat]||'🛍️')+'</span><span>'+escape(cat)+'</span></button>';html+='</div>';}
 html+='<a class="premiumSuggestFooter" href="letaky.html">Prohlédnout aktuální letáky <span>→</span></a>';
 panel.innerHTML=html;panel.hidden=false;positionPanel();input.setAttribute('aria-expanded','true');
 }
 function close(){editing=false;editError='';panel.hidden=true;input.setAttribute('aria-expanded','false')}
 // Opening suggestions requires an explicit user action; startup focus and
 // synthetic input events from legacy search synchronizers must not open them.
 input.addEventListener('click',render);
 input.addEventListener('input',e=>{
 if(document.activeElement!==input)return;
 editing=false;render();
 });
 input.addEventListener('keydown',e=>{
 if(e.key==='Escape')close();
 else if(e.key==='ArrowDown'){e.preventDefault();render();}
 });
 holder.addEventListener('focusout',()=>{
 setTimeout(()=>{if(!holder.contains(document.activeElement))close()},0);
 });
 window.addEventListener('pageshow',close);
 window.addEventListener('pagehide',close);
 panel.addEventListener('pointerdown',e=>{if(!e.target.closest('input,button,a'))e.preventDefault()});
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();input.focus({preventScroll:true});close();}else if(e.key==='Enter'&&e.target.matches('.premiumSuggestEditInput')){e.preventDefault();e.stopPropagation();addPopular();}});
 panel.addEventListener('click',e=>{
 const actionButton=e.target.closest('[data-popular-action]');
 if(actionButton){
 e.preventDefault();e.stopPropagation();
 const action=actionButton.dataset.popularAction,i=Number(actionButton.dataset.index);
 editError='';
 if(action==='edit'){editing=true;draft=readPopular();renderEditor();return;}
 if(action==='cancel'){editing=false;render();return;}
 if(action==='save'){
 try{localStorage.setItem(popularKey,JSON.stringify(draft));editing=false;render();}
 catch{editError='Uložení se nezdařilo. Prohlížeč nepovoluje ukládání.';renderEditor();}
 return;
 }
 if(action==='add'){addPopular();return;}
 if(Number.isInteger(i)&&i>=0&&i<draft.length){
 if(action==='remove')draft.splice(i,1);
 if(action==='up'&&i>0)[draft[i-1],draft[i]]=[draft[i],draft[i-1]];
 if(action==='down'&&i<draft.length-1)[draft[i+1],draft[i]]=[draft[i],draft[i+1]];
 }
 renderEditor();return;
 }
 const b=e.target.closest('[data-query]');if(b){input.value=b.dataset.query;search(b.dataset.query)}});
 document.addEventListener('pointerdown',e=>{if(!holder.contains(e.target))close()});
}
function init(){document.querySelectorAll('input[type="search"]').forEach(input=>{if(input.id==='leafletsStoreSearchInput')return;setup(input)})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();