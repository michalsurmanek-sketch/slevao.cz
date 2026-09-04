import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules']);
const resourceTags = new Set(['script', 'img', 'source', 'iframe', 'object', 'video', 'audio']);
const checkedLinkRels = new Set([
  'stylesheet',
  'icon',
  'shortcut',
  'manifest',
  'preload',
  'modulepreload',
  'apple-touch-icon',
  'mask-icon',
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function attrsFromTag(tag) {
  const attrs = new Map();
  const attrRe = /(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = attrRe.exec(tag))) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function isSkippable(raw) {
  const value = raw.trim();
  if (!value || value === '/') return true;
  if (value.startsWith('#') || value.startsWith('//')) return true;
  if (/^(?:https?:|data:|blob:|mailto:|tel:|javascript:)/i.test(value)) return true;
  if (/[{}]/.test(value) || /%7b|%7d/i.test(value)) return true;
  return false;
}

function cleanUrl(raw) {
  const withoutFragment = raw.split('#', 1)[0];
  const withoutQuery = withoutFragment.split('?', 1)[0];
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

function resolveLocal(htmlFile, raw) {
  const clean = cleanUrl(raw.trim());
  if (clean.startsWith('/')) return path.join(root, clean.replace(/^\/+/, ''));
  return path.resolve(path.dirname(htmlFile), clean);
}

function refsForTag(tagName, attrs) {
  if (tagName === 'link') {
    const rels = (attrs.get('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!rels.some((rel) => checkedLinkRels.has(rel))) return [];
    return attrs.has('href') ? [attrs.get('href')] : [];
  }

  if (!resourceTags.has(tagName)) return [];

  const refs = [];
  if (attrs.has('src')) refs.push(attrs.get('src'));
  if (tagName === 'object' && attrs.has('data')) refs.push(attrs.get('data'));
  if (tagName === 'video' && attrs.has('poster')) refs.push(attrs.get('poster'));
  if ((tagName === 'img' || tagName === 'source') && attrs.has('srcset')) {
    for (const part of attrs.get('srcset').split(',')) {
      const candidate = part.trim().split(/\s+/, 1)[0];
      if (candidate) refs.push(candidate);
    }
  }
  return refs;
}

const htmlFiles = walk(root);
const missing = [];
let checked = 0;

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const tagRe = /<(script|img|source|iframe|object|video|audio|link)\b[^>]*>/gi;
  let tagMatch;

  while ((tagMatch = tagRe.exec(html))) {
    const tagName = tagMatch[1].toLowerCase();
    const attrs = attrsFromTag(tagMatch[0]);
    for (const rawRef of refsForTag(tagName, attrs)) {
      if (isSkippable(rawRef)) continue;
      const resolved = resolveLocal(htmlFile, rawRef);
      checked += 1;
      if (!fs.existsSync(resolved)) {
        missing.push({
          html: path.relative(root, htmlFile),
          ref: rawRef,
          resolved: path.relative(root, resolved),
        });
      }
    }
  }
}

if (missing.length) {
  console.error(`Missing local static assets: ${missing.length}`);
  for (const item of missing) {
    console.error(`- ${item.html}: ${item.ref} -> ${item.resolved}`);
  }
  process.exit(1);
}

console.log(`OK: ${checked} local static asset references across ${htmlFiles.length} HTML files.`);
