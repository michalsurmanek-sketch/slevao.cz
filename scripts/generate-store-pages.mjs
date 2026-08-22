import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const STORE_NAV_VERSION = '20260822-1';
const STORE_NAV_SCRIPT = `assets/store-bottom-nav.js?v=${STORE_NAV_VERSION}`;
const STORE_FEED_VERSION = '20260822-2';
const STORE_FEED_SCRIPT = `assets/store-feed.js?v=${STORE_FEED_VERSION}`;
const STORE_FEED_CSS_VERSION = '20260801-16';
const STORE_NAV_CSS_VERSION = '20260802-3';
const EXPECTED_STORE_COUNT = 73;

const expansionMigration = readFileSync(new URL('../supabase/migrations/20260730124500_expand_czech_store_catalog.sql', import.meta.url), 'utf8').split(')\ninsert into public.stores')[0];
const canonicalCatalog = readFileSync(new URL('../supabase/migrations/20260801133000_complete_store_brand_logos.sql', import.meta.url), 'utf8');

function fallbackStoreName(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function existingStoreName(slug) {
  const pageUrl = new URL(`../${slug}.html`, import.meta.url);
  if (!existsSync(pageUrl)) return fallbackStoreName(slug);
  const html = readFileSync(pageUrl, 'utf8');
  const configMatch = html.match(/window\.SLEVAO_STORE\s*=\s*(\{[^;<>]+\})/);
  if (configMatch) {
    try {
      const config = JSON.parse(configMatch[1]);
      if (String(config?.name || '').trim()) return String(config.name).trim();
    } catch {}
  }
  const titleMatch = html.match(/<title>([^|<]+?)(?:\s+leták|\s+–|\s+\|)/i);
  return String(titleMatch?.[1] || '').trim() || fallbackStoreName(slug);
}

const stores = new Map();
for (const match of expansionMigration.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)'/g)) stores.set(match[1], match[2]);
for (const match of canonicalCatalog.matchAll(/\('([a-z0-9-]+)'\s*,\s*'[^']+'\)/g)) {
  const slug = match[1];
  if (!stores.has(slug)) stores.set(slug, existingStoreName(slug));
}
if (stores.size !== EXPECTED_STORE_COUNT) {
  throw new Error(`Kanonický katalog obchodů má ${stores.size} položek, očekáváno ${EXPECTED_STORE_COUNT}.`);
}

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const template = (slug, name) => {
  const safeName = escapeHtml(name);
  const storeJson = JSON.stringify({ slug, name }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeName} leták a akční nabídky dnes | Slevao.cz</title><meta name="description" content="Aktuální ${safeName} leták, slevy a akční ceny. Nabídky se automaticky aktualizují a po skončení platnosti zmizí.">
<link rel="canonical" href="https://slevao.cz/${slug}.html"><meta property="og:title" content="${safeName} – aktuální leták a slevy"><meta property="og:description" content="Živý přehled platných akcí obchodu ${safeName}."><meta property="og:url" content="https://slevao.cz/${slug}.html"><meta property="og:type" content="website"><link rel="icon" href="favicon.svg"><link rel="stylesheet" href="assets/store-feed.css?v=${STORE_FEED_CSS_VERSION}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":${JSON.stringify(`${name} – aktuální leták a slevy`)},"url":"https://slevao.cz/${slug}.html","isPartOf":{"@type":"WebSite","name":"Slevao.cz","url":"https://slevao.cz/"}}</script><link rel="stylesheet" href="assets/store-bottom-nav.css?v=${STORE_NAV_CSS_VERSION}">
</head>
<body><header class="top"><div class="c topin"><a class="logo" href="./"><i>%</i><span>SLEVAO<b>.cz</b></span></a><div class="search"><input id="q" type="search" placeholder="Hledat v akcích ${safeName}…" aria-label="Hledat v nabídkách"><button type="button" onclick="document.getElementById('q').focus()">Hledat</button></div></div></header>
<main><section class="hero"><div class="c"><div class="heroBox"><div class="storeHead"><img id="storeLogo" class="storeLogo" alt="Logo ${safeName}" hidden><div><h1><span id="titleName">${safeName}</span></h1><p>Aktuální akční nabídky, které právě platí.</p><div class="pills"><span class="pill" id="status">Načítám feed…</span><span class="pill" id="offerCount">0 nabídek</span><span class="pill" id="updated">Aktualizuji…</span></div></div></div></div></div></section>
<section class="c storeLeafletArea" aria-labelledby="storeLeafletHeading"><section class="leafletSection"><div class="leafletHead"><div><span class="eyebrow">AUTOMATICKÝ LETÁK</span><h2 id="storeLeafletHeading">Aktuální letáky</h2><p>Nový platný leták se zobrazí automaticky a skončený zmizí.</p></div></div><div id="leafletGrid" class="leafletGrid" aria-live="polite"><div class="leafletLoading">Načítám aktuální leták…</div></div><div id="leafletViewer" class="leafletViewer" hidden><div class="leafletViewerHead"><div><span class="eyebrow">PROHLÍŽÍŠ NA SLEVAO.CZ</span><h3 id="leafletViewerTitle">Aktuální leták</h3></div><button id="closeLeafletViewer" type="button" aria-label="Zavřít prohlížeč letáku">× Zavřít</button></div><div id="leafletViewerStatus" class="leafletViewerStatus">Načítám leták…</div><iframe id="leafletFrame" title="Prohlížeč aktuálního letáku" loading="lazy" referrerpolicy="no-referrer" allow="fullscreen"></iframe><p class="leafletViewerHelp">Leták můžeš listovat, přibližovat a otevřít přes celou obrazovku.</p></div></section></section>
<section class="c"><div class="toolbar"><div><h2>Akční nabídky</h2><div id="resultCount" class="muted">Načítám…</div></div><select id="sort" class="sort" aria-label="Řazení"><option value="newest">Nejnovější</option><option value="discount">Největší sleva</option><option value="saving">Největší úspora</option><option value="price">Nejnižší cena</option><option value="name">Podle názvu</option></select></div><div id="grid" class="grid"><div class="loading">Načítám aktuální leták…</div></div><div class="more"><button id="loadMore" class="loadMore" hidden>Načíst další nabídky</button></div><a class="back" href="./">← Všechny obchody a nabídky</a></section></main>
<footer><div class="c"><strong>SLEVAO.cz</strong><p>Platné slevy českých obchodů na jednom místě.</p></div></footer><script>window.SLEVAO_STORE=${storeJson}</script><script src="${STORE_FEED_SCRIPT}"></script><script src="${STORE_NAV_SCRIPT}"></script>
</body></html>`;
};

function patchExistingStorePage(pageUrl, slug) {
  const current = readFileSync(pageUrl, 'utf8');
  const navPattern = /assets\/store-bottom-nav\.js(?:\?v=[^"'\s<>]+)?/g;
  const feedPattern = /assets\/store-feed\.js(?:\?v=[^"'\s<>]+)?/g;
  const navMatches = current.match(navPattern) || [];
  const feedMatches = current.match(feedPattern) || [];
  if (navMatches.length !== 1) {
    throw new Error(`${slug}.html: očekáván právě jeden store-bottom-nav runtime, nalezeno ${navMatches.length}.`);
  }
  if (feedMatches.length !== 1) {
    throw new Error(`${slug}.html: očekáván právě jeden store-feed runtime, nalezeno ${feedMatches.length}.`);
  }
  const next = current
    .replace(navPattern, STORE_NAV_SCRIPT)
    .replace(feedPattern, STORE_FEED_SCRIPT);
  if (next === current) return false;
  writeFileSync(pageUrl, next);
  return true;
}

let created = 0;
let patched = 0;
for (const [slug, name] of [...stores].sort()) {
  const pageUrl = new URL(`../${slug}.html`, import.meta.url);
  if (existsSync(pageUrl)) {
    if (patchExistingStorePage(pageUrl, slug)) patched += 1;
    continue;
  }
  writeFileSync(pageUrl, template(slug, name));
  created += 1;
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://slevao.cz/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n${[...stores].sort().map(([slug]) => `  <url><loc>https://slevao.cz/${slug}.html</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`).join('\n')}\n</urlset>\n`;
writeFileSync(new URL('../sitemap.xml', import.meta.url), sitemap);
console.log(`Store stránky: ${stores.size}; nové: ${created}; bezpečně patchované: ${patched}.`);
