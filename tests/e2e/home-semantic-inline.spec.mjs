import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps semantic filter styles bundled and stays at 28 CSS requests', async ({ page }) => {
  const stylesheets = [];

  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== BASE_URL) return;
    if (request.resourceType() === 'stylesheet' && url.pathname.endsWith('.css')) {
      stylesheets.push(url.pathname);
    }
  });

  const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(3000);

  expect(stylesheets.filter((path) => path === '/assets/home-semantic-filters.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 28 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(28);

  const computed = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="slSemanticPanel">
        <div class="slSemanticMeta"><i></i><span>Upřesnit výběr</span></div>
        <div class="slSemanticRow"><button type="button">Test</button><button class="active" type="button">Aktivní</button></div>
        <div class="slSemanticInfo"><span>i</span>Informace</div>
      </div>`;
    document.body.appendChild(host);
    const panel = host.querySelector('.slSemanticPanel');
    const meta = host.querySelector('.slSemanticMeta');
    const button = host.querySelector('.slSemanticRow button');
    const active = host.querySelector('.slSemanticRow button.active');
    const info = host.querySelector('.slSemanticInfo');
    const result = {
      panelMarginBottom: getComputedStyle(panel).marginBottom,
      metaDisplay: getComputedStyle(meta).display,
      metaRadius: getComputedStyle(meta).borderRadius,
      buttonMinHeight: getComputedStyle(button).minHeight,
      buttonRadius: getComputedStyle(button).borderRadius,
      activeColor: getComputedStyle(active).color,
      infoMinHeight: getComputedStyle(info).minHeight,
    };
    host.remove();
    return result;
  });

  expect(computed.panelMarginBottom).toBe('22px');
  expect(computed.metaDisplay).toBe('flex');
  expect(computed.metaRadius).toBe('999px');
  expect(computed.buttonMinHeight).toBe('36px');
  expect(computed.buttonRadius).toBe('12px');
  expect(computed.activeColor).toBe('rgb(255, 255, 255)');
  expect(computed.infoMinHeight).toBe('36px');
});
