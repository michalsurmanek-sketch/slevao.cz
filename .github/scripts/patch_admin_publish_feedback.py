from pathlib import Path

p = Path('admin-automatizace.html')
text = p.read_text(encoding='utf-8')
old = "async function publishReview(id,button){button.disabled=true;try{const{data,error}=await db.functions.invoke('publish-imports',{body:{import_id:id}});if(error)throw error;if(data?.results?.[0]?.error)throw new Error(data.results[0].error);msg('runMsg','Import byl zveřejněn.');await loadAll()}catch(e){msg('runMsg',e.message||'Publikace selhala.','err');button.disabled=false}}"
new = "async function publishReview(id,button){const original=button.textContent;button.disabled=true;button.textContent='Zveřejňuji…';let inline=button.closest('.import')?.querySelector('.publishFeedback');if(!inline){inline=document.createElement('div');inline.className='publishFeedback meta';inline.style.marginTop='8px';button.closest('.importTop')?.querySelector('div')?.appendChild(inline)}inline.textContent='Probíhá zveřejnění importu…';inline.style.color='var(--blue)';try{const{data,error}=await db.functions.invoke('publish-imports',{body:{import_id:id}});if(error)throw error;if(data?.results?.[0]?.error)throw new Error(data.results[0].error);inline.textContent='Import byl úspěšně zveřejněn.';inline.style.color='var(--ok)';button.textContent='Zveřejněno';msg('runMsg','Import byl zveřejněn.');setTimeout(loadAll,900)}catch(e){const message=e.message||'Publikace selhala.';inline.textContent=message;inline.style.color='var(--bad)';button.textContent='Zkusit znovu';button.disabled=false;msg('runMsg',message,'err')}}"
if old not in text:
    raise SystemExit('publishReview block not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
