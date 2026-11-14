(()=>{'use strict';
const $=id=>document.getElementById(id),core=window.SlevaoRecipeCore,builtins=window.SlevaoRecipeCatalog||[],db=window.SlevaoSupabase?.getClient(),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user=null,community=[],category='Vše',source='all',offset=0,hasMore=false,loading=false,version=0,saving=false,previewUrl='',oldImage=null,toastTimer;
const imageUrl=path=>path&&/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/.test(path)?window.SlevaoSupabase.url+'/storage/v1/object/public/recipe-images/'+path:null;
function toast(text){$('recipeToast').textContent=text;$('recipeToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('recipeToast').hidden=true,4500)}
function status(text,error=false){$('recipeLoadStatus').textContent=text;$('recipeLoadStatus').classList.toggle('isError',error)}
function recipeById(id){return [...builtins,...community].find(r=>r.id===id)}
function photo(r,className='rCardImage'){const url=imageUrl(r.image_path);return url?'<img class="'+className+'" src="'+esc(url)+'" alt="'+esc(r.title)+'" loading="lazy">':r.builtin?'<div class="rPhoto '+className+'" role="img" aria-label="'+esc(r.title)+'" style="background-position:'+esc(r.photo_position)+'"></div>':'<div class="rCardPlaceholder '+className+'" aria-label="Recept bez fotografie">♨</div>'}
function render(){
 const query=core.normalize($('recipeSearch').value),time=Number($('recipeTime').value);
 const rows=(source==='all'?[...builtins,...community]:community).filter(r=>(category==='Vše'||r.category===category)&&(!time||r.minutes<=time)&&(!query||core.normalize(r.title+' '+r.description+' '+r.ingredients.join(' ')).includes(query)));
 $('recipeGrid').innerHTML=rows.length?rows.map(r=>'<article class="rCard"><a href="#recept='+encodeURIComponent(r.id)+'" aria-label="Otevřít '+esc(r.title)+'">'+photo(r)+'</a><div class="rCardBody"><span class="rCardCategory">'+esc(r.category)+(r.published===false?' · Koncept':'')+'</span><h3><a href="#recept='+encodeURIComponent(r.id)+'">'+esc(r.title)+'</a></h3><p>'+esc(r.description)+'</p><div class="rCardMeta"><span>◷ '+r.minutes+' min</span><span>♧ '+r.servings+' porce</span></div><div class="rCardBottom"><small>'+esc(r.author_name)+'</small><a href="#recept='+encodeURIComponent(r.id)+'">Uvařit a nakoupit ↗</a></div></div></article>').join(''):'<div class="rEmpty">'+(source==='mine'&&!user?'Pro své recepty se nejprve <a href="ucet.html?redirect=recepty.html">přihlaste</a>.':loading?'Načítám recepty…':'Zatím žádný recept. Zkuste jiné hledání nebo přidejte vlastní.')+'</div>';
 $('recipeCount').textContent=rows.length+' receptů';$('recipeLoadMore').hidden=!hasMore;$('recipeLoadMore').disabled=loading;
 document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('isActive',b.dataset.source===source);b.setAttribute('aria-pressed',String(b.dataset.source===source))});
}
async function loadMore(reset=false){
 const token=++version;
 if(reset){offset=0;community=[];hasMore=false;}
 if(!db){status('Komunitní recepty se nepodařilo připojit. Redakční inspirace je dostupná níže.',true);render();return;}
 if(source==='mine'&&!user){status('');render();return;}
 loading=true;status('Načítám komunitní recepty…');render();
 try{const {data,error}=await db.rpc('search_community_recipes',{p_term:$('recipeSearch').value.trim().slice(0,100),p_category:category==='Vše'?null:category,p_minutes:Number($('recipeTime').value)||null,p_mine:source==='mine',p_offset:offset});if(token!==version)return;if(error)throw error;
 community=reset?(data||[]):[...community,...(data||[])];offset+=data?.length||0;hasMore=data?.length===12;status('');
 }catch{if(token===version)status('Komunitní recepty se nepodařilo načíst. Zkuste změnit filtr nebo stránku obnovit.',true)}finally{if(token===version){loading=false;render();await handleHash()}}
}
function closeDetail(){if($('recipeDetail').open)$('recipeDetail').close();if(location.hash.startsWith('#recept='))history.replaceState(null,'',location.pathname+location.search+'#recepty')}
function showDetail(r){
 $('recipeDetailContent').innerHTML=photo(r,'rDetailPhoto')+'<div class="rDetailBody"><span class="rEyebrow">'+esc(r.category)+'</span><h2 id="detailTitle">'+esc(r.title)+'</h2><p>'+esc(r.description)+'</p><div class="rDetailMeta"><span>◷ '+r.minutes+' minut</span><span>'+r.servings+' porce</span><span>Od: '+esc(r.author_name)+'</span></div><div class="rDetailColumns"><section><h3>Suroviny</h3><p class="rStatus">Odznačte, co už máte doma.</p>'+r.ingredients.map((name,i)=>'<label class="rIngredient"><input type="checkbox" checked data-ingredient="'+i+'"><span>'+esc(name)+'</span></label>').join('')+'</section><section><h3>Postup přípravy</h3><ol class="rSteps">'+r.steps.map(step=>'<li>'+esc(step)+'</li>').join('')+'</ol></section></div><div class="rDetailActions"><button type="button" class="rButton rPrimary" data-add-ingredients="'+esc(r.id)+'">Přidat suroviny do seznamu</button><a class="rButton" href="seznam.html">Otevřít seznam →</a>'+(user&&r.user_id===user.id?'<button type="button" class="rButton" data-edit-recipe="'+esc(r.id)+'">Upravit můj recept</button><button type="button" class="rButton" data-delete-recipe="'+esc(r.id)+'">Odstranit</button>':'')+'</div></div>';
 if(!$('recipeDetail').open)$('recipeDetail').showModal();document.title=r.title+' | Recepty Slevao.cz';
}
async function handleHash(){
 if(location.hash==='#pridat'){openEditor();return;}
 if(!location.hash.startsWith('#recept='))return;
 const id=decodeURIComponent(location.hash.slice(8));let r=recipeById(id);
 if(!r&&db&&/^[a-f0-9-]{36}$/.test(id)){const {data}=await db.from('community_recipes').select('*').eq('id',id).maybeSingle();if(location.hash!=='#recept='+id)return;if(data){community.push(data);r=data;}}
 if(r)showDetail(r);else if(!loading)toast('Recept není dostupný nebo už byl odstraněn.');
}
function addIngredients(r){
 const names=[...$('recipeDetail').querySelectorAll('[data-ingredient]:checked')].map(x=>r.ingredients[Number(x.dataset.ingredient)]);
 if(!names.length){toast('Vyberte alespoň jednu surovinu.');return;}
 try{const rows=JSON.parse(localStorage.getItem('slevao-shopping-list-v1')||'[]');const result=core.mergeIngredients(rows,names,r.id,()=>crypto.randomUUID(),new Date().toISOString());localStorage.setItem('slevao-shopping-list-v1',JSON.stringify(result.rows));window.SlevaoPublic?.updateNavCount?.();toast(result.added?'Do seznamu přidáno '+result.added+' surovin.':'Suroviny už v seznamu máte.');}catch{toast('Seznam se nepodařilo uložit. Zkontrolujte povolení úložiště prohlížeče.');}
}
function draftKey(){return 'slevao-recipe-draft-v1:'+(user?.id||'guest')}
function formValue(){return {title:$('recipeTitle').value.trim(),author_name:$('recipeAuthor').value.trim(),description:$('recipeDescription').value.trim(),category:$('recipeCategory').value,minutes:Number($('recipeMinutes').value),servings:Number($('recipeServings').value),ingredients:core.lines($('recipeIngredients').value),steps:core.lines($('recipeSteps').value),published:$('recipePublished').checked}}
function fillForm(r){$('recipeTitle').value=r.title||'';$('recipeAuthor').value=r.author_name||'';$('recipeDescription').value=r.description||'';$('recipeCategory').value=r.category||'Hlavní jídla';$('recipeMinutes').value=r.minutes||30;$('recipeServings').value=r.servings||4;$('recipeIngredients').value=(r.ingredients||[]).join('\n');$('recipeSteps').value=(r.steps||[]).join('\n');$('recipePublished').checked=r.published!==false}
function openEditor(r=null){
 if(saving)return;closeDetail();$('recipeForm').reset();$('recipeEditId').value=r?.id||'';oldImage=r?.image_path||null;$('recipeImagePreview').hidden=true;$('recipeSaveStatus').textContent='';
 if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}
 $('recipeLoginGate').hidden=!!user;$('recipeForm').hidden=!user;
 if(user){let draft={};if(!r)try{draft=JSON.parse(localStorage.getItem(draftKey())||'{}')}catch{}fillForm(r||{...draft,author_name:draft.author_name||user.user_metadata?.display_name||''});if(oldImage){$('recipeImagePreview').src=imageUrl(oldImage);$('recipeImagePreview').hidden=false;}}
 $('editorTitle').textContent=r?'Upravit můj recept':'Podělte se o svůj recept';if(!$('recipeEditor').open)$('recipeEditor').showModal();
}
async function compressPhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Vyberte JPG, PNG nebo WebP do 10 MB.');
 const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>80000000)throw Error('Fotografie má příliš velké rozlišení.');const ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.82));if(!blob||blob.type!=='image/webp'||blob.size>2097152)throw Error('Fotografii se nepodařilo zmenšit. Zkuste menší obrázek.');return blob;}finally{bitmap.close();}}
async function saveRecipe(event){
 event.preventDefault();if(saving||!db||!user)return;let uploaded=null;const owner=user.id;saving=true;$('recipeSave').disabled=true;$('recipeSaveStatus').textContent='Ukládám recept…';
 try{const recipe=core.validate(formValue()),{data:verified,error:authError}=await db.auth.getUser();if(authError||verified.user?.id!==owner)throw Error('Přihlášení vypršelo. Přihlaste se znovu.');let image=oldImage;const file=$('recipeImage').files[0];if(file){const blob=await compressPhoto(file);uploaded=owner+'/'+crypto.randomUUID()+'.webp';const {error}=await db.storage.from('recipe-images').upload(uploaded,blob,{contentType:'image/webp',upsert:false});if(error)throw Error('Fotografii se nepodařilo uložit. Zkuste to znovu.');image=uploaded;}
 const id=$('recipeEditId').value||crypto.randomUUID();let q=$('recipeEditId').value?db.from('community_recipes').update({...recipe,image_path:image,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',owner):db.from('community_recipes').insert({...recipe,id,user_id:owner,image_path:image});const {data,error}=await q.select().single();if(error)throw Error('Recept se nepodařilo uložit. Vaše rozepsané údaje zůstávají ve formuláři.');
 if(oldImage&&uploaded&&oldImage!==uploaded)await db.storage.from('recipe-images').remove([oldImage]);uploaded=null;try{localStorage.removeItem(draftKey())}catch{}$('recipeEditor').close();source='mine';category='Vše';$('recipeSearch').value='';$('recipeTime').value='0';renderCategories();await loadMore(true);toast(data.published?'Recept je zveřejněný. Děkujeme za inspiraci!':'Koncept receptu je uložený mezi vašimi recepty.');
 }catch(error){if(uploaded)await db.storage.from('recipe-images').remove([uploaded]);$('recipeSaveStatus').textContent=error.message||'Uložení se nezdařilo.';}finally{saving=false;$('recipeSave').disabled=false;}
}
async function deleteRecipe(r){if(!db||!user||r.user_id!==user.id||!confirm('Opravdu chcete odstranit svůj recept „'+r.title+'“?'))return;const {error}=await db.from('community_recipes').delete().eq('id',r.id).eq('user_id',user.id);if(error){toast('Recept se nepodařilo odstranit.');return;}if(r.image_path)await db.storage.from('recipe-images').remove([r.image_path]);closeDetail();await loadMore(true);toast('Recept byl odstraněn.');}
function renderCategories(){$('recipeCategories').innerHTML=['Vše',...core.categories].map(c=>'<button type="button" data-category="'+esc(c)+'" class="'+(c===category?'isActive':'')+'" aria-pressed="'+(c===category)+'">'+esc(c)+'</button>').join('')}
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.matches('[data-add-recipe]'))openEditor();if(b.matches('[data-close-dialog]')){if(saving)return;const dialog=b.closest('dialog');dialog.close();if(dialog.id==='recipeDetail')closeDetail();if(location.hash==='#pridat')history.replaceState(null,'',location.pathname+'#recepty');}if(b.dataset.category){category=b.dataset.category;renderCategories();loadMore(true);}if(b.dataset.source){source=b.dataset.source;loadMore(true);}if(b.dataset.addIngredients){const r=recipeById(b.dataset.addIngredients);if(r)addIngredients(r);}if(b.dataset.editRecipe)openEditor(recipeById(b.dataset.editRecipe));if(b.dataset.deleteRecipe)deleteRecipe(recipeById(b.dataset.deleteRecipe));});
$('leafletsSearchToggle')?.addEventListener('click',()=>{
 $('recipeSearch').scrollIntoView({behavior:'smooth',block:'center'});
 $('recipeSearch').focus({preventScroll:true});
 $('leafletsSearchToggle').setAttribute('aria-expanded','true');
});
$('recipeSearch').addEventListener('blur',()=>$('leafletsSearchToggle')?.setAttribute('aria-expanded','false'));
$('recipeForm').addEventListener('submit',saveRecipe);$('recipeLoadMore').addEventListener('click',()=>loadMore());$('recipeTime').addEventListener('change',()=>loadMore(true));let searchTimer;$('recipeSearch').addEventListener('input',()=>{render();clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadMore(true),300)});
$('recipeForm').addEventListener('input',()=>{if(user&&!$('recipeEditId').value)try{localStorage.setItem(draftKey(),JSON.stringify(formValue()))}catch{}});
$('recipeImage').addEventListener('change',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);const file=$('recipeImage').files[0];if(file){previewUrl=URL.createObjectURL(file);$('recipeImagePreview').src=previewUrl;$('recipeImagePreview').hidden=false;}});
$('recipeEditor').addEventListener('cancel',e=>{if(saving)e.preventDefault();else if(location.hash==='#pridat')history.replaceState(null,'',location.pathname+'#recepty')});$('recipeDetail').addEventListener('cancel',()=>closeDetail());window.addEventListener('hashchange',handleHash);
async function init(){renderCategories();render();if(db){const {data}=await db.auth.getSession();user=data.session?.user||null;db.auth.onAuthStateChange((_event,session)=>{const previous=user?.id;user=session?.user||null;if(previous!==user?.id){if($('recipeEditor').open&&!saving)$('recipeEditor').close();setTimeout(()=>loadMore(true),0);}});}await loadMore(true);await handleHash();}
init().catch(()=>{status('Připojení se nezdařilo. Redakční recepty zůstávají dostupné.',true);render();});
})();
