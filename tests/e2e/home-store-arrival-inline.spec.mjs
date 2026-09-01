import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps store-arrival styles bundled and stays at 29 CSS requests', async ({ page }) => {
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

  expect(stylesheets.filter((path) => path === '/assets/store-arrival-alerts.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 29 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(29);

  const computed = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="slArrivalControl">
        <button class="slArrivalToggle" type="button">
          <span class="slArrivalIcon">◎</span>
          <span class="slArrivalCopy"><strong>Upozornit při příchodu</strong><small>Test</small></span>
          <span class="slArrivalSwitch"><i></i></span>
        </button>
        <div class="slArrivalStatus">Připraveno</div>
      </div>`;
    document.body.appendChild(host);
    const toggle = host.querySelector('.slArrivalToggle');
    const icon = host.querySelector('.slArrivalIcon');
    const switcher = host.querySelector('.slArrivalSwitch');
    const status = host.querySelector('.slArrivalStatus');
    const toggleStyle = getComputedStyle(toggle);
    const iconStyle = getComputedStyle(icon);
    const switchStyle = getComputedStyle(switcher);
    const statusStyle = getComputedStyle(status);
    const result = {
      toggleDisplay: toggleStyle.display,
      toggleMinHeight: toggleStyle.minHeight,
      toggleBorderRadius: toggleStyle.borderRadius,
      iconWidth: iconStyle.width,
      iconHeight: iconStyle.height,
      switchWidth: switchStyle.width,
      switchHeight: switchStyle.height,
      statusMinHeight: statusStyle.minHeight,
    };
    host.remove();
    return result;
  });

  expect(computed.toggleDisplay).toBe('grid');
  expect(computed.toggleMinHeight).toBe('58px');
  expect(computed.toggleBorderRadius).toBe('14px');
  expect(computed.iconWidth).toBe('38px');
  expect(computed.iconHeight).toBe('38px');
  expect(computed.switchWidth).toBe('38px');
  expect(computed.switchHeight).toBe('22px');
  expect(computed.statusMinHeight).toBe('15px');
});
