import { readFileSync, writeFileSync } from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20260730124500_expand_czech_store_catalog.sql',import.meta.url),'utf8').split(')\ninsert into public.stores')[0];
const homepage=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const stores=new Map();
for(const match of migration.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)'/g))stores.set(match[1],match[2]);
const catalog=homepage.match(/const CATALOG=\[(.*?)\]\.map/s)?.[1]||'';
for(const match of catalog.matchAll(/\['([^']+)','([^']+)'/g))stores.set(match[1],match[2]);

const template=(slug,name)=>`<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} leták a akční nabídky dnes | Slevao.cz</title><meta name="description" content="Aktuální ${name} leták, slevy a akční ceny. Nabídky se automaticky aktualizují a po skončení platnosti zmizí.">
<link rel="canonical" href="https://slevao.cz/${slug}.html"><meta property="og:title" content="${name} – aktuální leták a slevy"><meta property="og:description" content="Živý přehled platných akcí obchodu ${name}."><meta property="og:url" content="https://slevao.cz/${slug}.html"><meta property="og:type" content="website"><link rel="icon" href="favicon.svg"><link rel="stylesheet" href="assets/store-feed.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"${name} – aktuální leták a slevy","url":"https://slevao.cz/${slug}.html","isPartOf":{"@type":"WebSite","name":"Slevao.cz","url":"https://slevao.cz/"}}</script></head>
<body><header class="top"><div class="c topin"><a class="logo" href="./"><i>%</i><span>SLEVAO<b>.cz</b></span></a><div class="search"><input id="q" type="search" placeholder="Hledat v akcích ${name}…" aria-label="Hledat v nabídkách"><button type="button" onclick="document.getElementById('q').focus()">Hledat</button></div></div></header>
<main><section class="hero"><div class="c"><div class="heroBox"><div class="storeHead"><img id="storeLogo" class="storeLogo" alt="Logo ${name}" hidden><div><h1><span id="titleName">${name}</span> leták</h1><p>Aktuální akční nabídky, které právě platí.</p><div class="pills"><span class="pill" id="status">Načítám feed…</span><span class="pill" id="offerCount">0 nabídek</span><span class="pill" id="updated">Aktualizuji…</span></div></div></div></div></div></section>
<section class="c"><div class="toolbar"><div><h2>Akční nabídky</h2><div id="resultCount" class="muted">Načítám…</div></div><select id="sort" class="sort" aria-label="Řazení"><option value="newest">Nejnovější</option><option value="discount">Největší sleva</option><option value="saving">Největší úspora</option><option value="price">Nejnižší cena</option><option value="name">Podle názvu</option></select></div><div id="grid" class="grid"><div class="loading">Načítám aktuální leták…</div></div><div class="more"><button id="loadMore" class="loadMore" hidden>Načíst další nabídky</button></div><a class="back" href="./">← Všechny obchody a nabídky</a></section></main>
<footer><div class="c"><strong>SLEVAO.cz</strong><p>Platné slevy českých obchodů na jednom místě.</p></div></footer><script>window.SLEVAO_STORE=${JSON.stringify({slug,name})}</script><script src="assets/store-feed.js"></script></body></html>
`;
for(const [slug,name] of [...stores].sort())writeFileSync(new URL(`../${slug}.html`,import.meta.url),template(slug,name));
const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://slevao.cz/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n${[...stores].sort().map(([slug])=>`  <url><loc>https://slevao.cz/${slug}.html</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`).join('\n')}\n</urlset>\n`;
writeFileSync(new URL('../sitemap.xml',import.meta.url),sitemap);
console.log(`Vygenerováno ${stores.size} stránek obchodů.`);
