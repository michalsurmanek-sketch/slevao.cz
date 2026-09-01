import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps in-store extension styles in one CSS request and stays at 30 CSS requests', async ({ page }) => {
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

  expect(stylesheets.filter((path) => path === '/assets/home-in-store.css')).toHaveLength(1);
  expect(stylesheets.filter((path) => path === '/assets/home-in-store-actions.css')).toEqual([]);
  expect(stylesheets.filter((path) => path === '/assets/home-in-store-list.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 30 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(30);

  const computed = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="slInStoreActions">
        <button type="button">Do seznamu</button>
        <a href="#">Seznam + trasa</a>
      </div>
      <section class="slInStoreListCoverage">
        <div class="slInStoreListCoverageHead"><div><small>TVŮJ SEZNAM</small><strong>2 položky</strong></div><b>99 Kč</b></div>
      </section>`;
    document.body.appendChild(host);
    const actions = host.querySelector('.slInStoreActions');
    const button = actions.querySelector('button');
    const coverage = host.querySelector('.slInStoreListCoverage');
    const actionsStyle = getComputedStyle(actions);
    const buttonStyle = getComputedStyle(button);
    const coverageStyle = getComputedStyle(coverage);
    const result = {
      actionsDisplay: actionsStyle.display,
      actionsBorderTopStyle: actionsStyle.borderTopStyle,
      buttonMinHeight: buttonStyle.minHeight,
      coverageBorderRadius: coverageStyle.borderRadius,
      coverageMarginTop: coverageStyle.marginTop,
      coverageBackground: coverageStyle.backgroundColor,
    };
    host.remove();
    return result;
  });

  expect(computed.actionsDisplay).toBe('flex');
  expect(computed.actionsBorderTopStyle).toBe('solid');
  expect(computed.buttonMinHeight).toBe('34px');
  expect(computed.coverageBorderRadius).toBe('17px');
  expect(computed.coverageMarginTop).toBe('14px');
  expect(computed.coverageBackground).toBe('rgb(251, 253, 252)');
});
