import { test, expect } from '@playwright/test';

const HOME = 'http://127.0.0.1:4173/index.html';

async function dispatchInstallPrompt(page, outcome = 'dismissed') {
  await page.evaluate((choiceOutcome) => {
    const event = new Event('beforeinstallprompt', { cancelable:true });
    Object.defineProperty(event, 'prompt', { value:async () => {} });
    Object.defineProperty(event, 'userChoice', {
      value:Promise.resolve({ outcome:choiceOutcome, platform:'web' })
    });
    window.dispatchEvent(event);
  }, outcome);
}

test('PWA install prompt waits for a completed first-visit action and respects permanent dismissal', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      for (const key of [
        'slevao-install-visit-count',
        'slevao-install-dismissed-permanently',
        'slevao-install-cooldown-until',
        'slevao-install-last-shown'
      ]) localStorage.removeItem(key);
      sessionStorage.removeItem('slevao-install-visit-counted');
    } catch {}
  });

  await page.goto(HOME, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => typeof window.SlevaoPwaInstall?.markSuccessfulAction === 'function');
  await dispatchInstallPrompt(page);

  // A bare first-visit CTA click must not earn an installation interruption.
  await page.locator('#searchButton').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('.sfInstallPrompt')).toHaveCount(0);

  // Move away from the hero/Autopilot blockers and report a completed action.
  await page.mouse.wheel(0, 12000);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('slevao:successful-action', {
    detail:{ type:'e2e-completed-action' }
  })));
  await expect(page.locator('.sfInstallPrompt')).toBeVisible({ timeout:5000 });

  await page.locator('.sfInstallPrompt__close').click();
  await expect(page.locator('.sfInstallPrompt')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('slevao-install-dismissed-permanently'))).toBe('1');

  // A later browser install event must remain silent after explicit permanent dismissal.
  await dispatchInstallPrompt(page);
  await page.evaluate(() => window.SlevaoPwaInstall.markSuccessfulAction());
  await page.waitForTimeout(1600);
  await expect(page.locator('.sfInstallPrompt')).toHaveCount(0);
});
