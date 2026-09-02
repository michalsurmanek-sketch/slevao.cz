import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps radius selector styles bundled and stays at 25 CSS requests', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 844 });
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

  expect(stylesheets.filter((path) => path === '/assets/home-radius-select.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 25 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(25);

  const computed = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="heroNearbyPanel">
        <div class="slLiveOptions">
          <label>
            <div class="slRadiusControl">
              <button class="slRadiusTrigger" type="button">
                <span class="slRadiusPin"></span>
                <span class="slRadiusValue">15 km</span>
                <span class="slRadiusChevron"></span>
              </button>
              <select class="slRadiusNative"><option>15 km</option></select>
            </div>
          </label>
          <button class="slLiveLocationButton" type="button">Moje poloha</button>
        </div>
      </div>
      <div class="slRadiusMenu">
        <button class="slRadiusOption is-active" type="button"><span>15 km</span><i></i></button>
      </div>`;
    document.body.appendChild(host);

    const panel = host.querySelector('.heroNearbyPanel');
    const options = host.querySelector('.slLiveOptions');
    const control = host.querySelector('.slRadiusControl');
    const trigger = host.querySelector('.slRadiusTrigger');
    const native = host.querySelector('.slRadiusNative');
    const menu = host.querySelector('.slRadiusMenu');
    const option = host.querySelector('.slRadiusOption');
    const location = host.querySelector('.slLiveLocationButton');

    const result = {
      panelOverflow: getComputedStyle(panel).overflow,
      optionsColumns: getComputedStyle(options).gridTemplateColumns,
      controlWidth: getComputedStyle(control).width,
      controlMaxWidth: getComputedStyle(control).maxWidth,
      triggerHeight: getComputedStyle(trigger).height,
      nativeWidth: getComputedStyle(native).width,
      nativeHeight: getComputedStyle(native).height,
      nativeOpacity: getComputedStyle(native).opacity,
      nativePointerEvents: getComputedStyle(native).pointerEvents,
      menuWidth: getComputedStyle(menu).width,
      menuPosition: getComputedStyle(menu).position,
      optionMinHeight: getComputedStyle(option).minHeight,
      locationHeight: getComputedStyle(location).height,
    };
    host.remove();
    return result;
  });

  expect(computed.panelOverflow).toBe('visible');
  expect(computed.controlWidth).toBe('118px');
  expect(computed.controlMaxWidth).toBe('118px');
  expect(computed.triggerHeight).toBe('46px');
  expect(computed.nativeWidth).toBe('1px');
  expect(computed.nativeHeight).toBe('1px');
  expect(computed.nativeOpacity).toBe('0');
  expect(computed.nativePointerEvents).toBe('none');
  expect(computed.menuWidth).toBe('150px');
  expect(computed.menuPosition).toBe('fixed');
  expect(computed.optionMinHeight).toBe('42px');
  expect(computed.locationHeight).toBe('46px');
});
