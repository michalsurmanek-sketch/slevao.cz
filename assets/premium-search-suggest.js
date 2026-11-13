(()=>{'use strict';
const popular=['mléko','máslo','káva','vejce','banány','kuřecí maso','mouka','cukr'];
const categories=['Potraviny','Drogerie','Nápoje','Ovoce a zelenina','Maso','Pečivo','Domácnost'];
const categoryIcons={'Potraviny':'🛒','Drogerie':'🧴','Nápoje':'🥤','Ovoce a zelenina':'🍌','Maso':'🥩','Pečivo':'🥐','Domácnost':'🏠'};
const productIcons={'mléko':'🥛','máslo':'🧈','káva':'☕','vejce':'🥚','banány':'🍌','kuřecí maso':'🍗','mouka':'🌾','cukr':'🍬'};
const normalize=s=>s.toLocaleLowerCase('cs').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setup(input){
 if(input.dataset.premiumSuggest==='1')return;
 input.dataset.premiumSuggest='1';
 const holder=input.closest('form')||input.parentElement;
 if(!holder)return;
 holder.classList.add('premiumSuggestHost');
 const panel=document.createElement('div');panel.className='premiumSuggestPanel';panel.hidden=true;
 panel.setAttribute('role','listbox');panel.setAttribute('aria-label','Návrhy vyhledávání');
 holder.appendChild(panel);
 input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
 const search=(value)=>{const q=value.trim();if(!q)return;location.href='index.html?q='+encodeURIComponent(q)+'#dealsSection'};
 function render(){
 const value=input.value.trim(),norm=normalize(value);
 const words=(value?popular.filter(x=>normalize(x).includes(norm)):popular).slice(0,5);
 const cats=(value?categories.filter(x=>normalize(x).includes(norm)):categories).slice(0,4);
 let html='<div class="premiumSuggestHeading"><span>✦ Chytré vyhledávání</span><small>Produkty · Kategorie · Akce</small></div>';
 if(value)html+='<button type="button" class="premiumSuggestRow" data-query="'+escape(value)+'"><span class="premiumSuggestGlyph">⌕</span><span><strong>Hledat „'+escape(value)+'“</strong><small>Zobrazit odpovídající nabídky</small></span><span>›</span></button>';
 if(words.length){html+='<div class="premiumSuggestCaption">'+(value?'Podobné hledání':'Často hledané')+'</div>';for(const word of words)html+='<button type="button" class="premiumSuggestRow" data-query="'+escape(word)+'"><span class="premiumSuggestGlyph">⌕</span><span><strong>'+escape(word)+'</strong><small>Vyhledat v nabídkách</small></span><span>›</span></button>';}
 if(cats.length){html+='<div class="premiumSuggestCaption">Kategorie</div><div class="premiumSuggestChips">';for(const cat of cats)html+='<button type="button" data-query="'+escape(cat)+'"><span class="premiumSuggestCategoryIcon" aria-hidden="true">'+(categoryIcons[cat]||'🛍️')+'</span><span>'+escape(cat)+'</span></button>';html+='</div>';}
 html+='<a class="premiumSuggestFooter" href="letaky.html">Prohlédnout aktuální letáky <span>→</span></a>';
 panel.innerHTML=html;panel.hidden=false;input.setAttribute('aria-expanded','true');
 }
 function close(){panel.hidden=true;input.setAttribute('aria-expanded','false')}
 input.addEventListener('focus',render);
 input.addEventListener('input',render);
 input.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
 panel.addEventListener('pointerdown',e=>e.preventDefault());
 panel.addEventListener('click',e=>{const b=e.target.closest('[data-query]');if(b){input.value=b.dataset.query;search(b.dataset.query)}});
 document.addEventListener('pointerdown',e=>{if(!holder.contains(e.target))close()});
}
function init(){document.querySelectorAll('input[type="search"]').forEach(input=>{if(input.id==='leafletsStoreSearchInput')return;setup(input)})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();