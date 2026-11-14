(function(root){
'use strict';
const categories=['Hlavní jídla','Polévky','Bez masa','Dezerty','Snídaně','Ostatní'];
const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const lines=v=>String(v||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
function validate(recipe){
 if(recipe.title.trim().length<3||recipe.title.length>120)throw Error('Název musí mít 3 až 120 znaků.');
 if(recipe.author_name.trim().length<2||recipe.author_name.length>60)throw Error('Vyplňte jméno autora (2 až 60 znaků).');
 if(recipe.description.length>800)throw Error('Úvod může mít nejvýše 800 znaků.');
 if(!categories.includes(recipe.category))throw Error('Vyberte kategorii.');
 if(!Number.isInteger(recipe.minutes)||recipe.minutes<1||recipe.minutes>1440)throw Error('Doba přípravy musí být 1 až 1440 minut.');
 if(!Number.isInteger(recipe.servings)||recipe.servings<1||recipe.servings>50)throw Error('Počet porcí musí být 1 až 50.');
 if(!Array.isArray(recipe.ingredients)||recipe.ingredients.length<1||recipe.ingredients.length>60||recipe.ingredients.some(x=>typeof x!=='string'||!x.trim()||x.length>200)||recipe.ingredients.join('').length>12000)throw Error('Vyplňte 1 až 60 surovin, každou na samostatný řádek (nejvýše 200 znaků na surovinu).');
 if(!Array.isArray(recipe.steps)||recipe.steps.length<1||recipe.steps.length>40||recipe.steps.some(x=>typeof x!=='string'||!x.trim())||recipe.steps.join('').length>16000)throw Error('Vyplňte 1 až 40 kroků postupu (nejvýše 16 000 znaků).');
 return recipe;
}
function mergeIngredients(rows,ingredients,recipeId,uid,now){
 if(!Array.isArray(rows))throw Error('Nákupní seznam není dostupný.');
 let added=0;
 for(const name of ingredients){
  const existing=rows.find(r=>r&&!r.completed&&!r.is_completed&&!r.product_id&&r.source==='recipe'&&normalize(r.custom_name||r.name)===normalize(name));
  if(existing){existing.recipe_ids=[...new Set([existing.recipe_id,...(Array.isArray(existing.recipe_ids)?existing.recipe_ids:[]),recipeId].filter(Boolean))];existing.recipe_dirty=1;existing.updated_at=now;delete existing.recipe_cloud_synced;continue;}
  rows.push({local_id:uid(),key:'c:'+normalize(name),product_id:null,selected_offer_id:null,custom_name:name,name,quantity:1,qty:1,unit:'ks',completed:false,source:'recipe',recipe_id:recipeId,recipe_ids:[recipeId],recipe_dirty:1,added_at:now});added++;
 }
 return {rows,added};
}
const api={categories,normalize,lines,validate,mergeIngredients};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SlevaoRecipeCore=api;
})(typeof window!=='undefined'?window:globalThis);
