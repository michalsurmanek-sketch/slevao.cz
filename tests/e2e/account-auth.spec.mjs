import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const CDN_PATTERN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4';

const MOCK_SUPABASE = `
(() => {
  const calls = window.__slevaoAuthCalls = [];
  const listeners = [];
  const response = () => ({ data: [], count: 0, error: null });

  function query() {
    const q = {};
    for (const method of ['select','eq','is','order','limit','insert','update','delete','filter','in','gte','lte']) {
      q[method] = () => q;
    }
    q.maybeSingle = () => q;
    q.single = () => q;
    q.then = (resolve, reject) => Promise.resolve(response()).then(resolve, reject);
    return q;
  }

  function emit(event, session) {
    queueMicrotask(() => listeners.slice().forEach((listener) => listener(event, session)));
  }

  const auth = {
    async signInWithPassword(payload) {
      calls.push({ method: 'signInWithPassword', payload });
      const session = { user: { id: '11111111-1111-4111-8111-111111111111', email: payload.email } };
      emit('SIGNED_IN', session);
      return { data: { session }, error: null };
    },
    async signUp(payload) {
      calls.push({ method: 'signUp', payload });
      return { data: { session: null, user: { id: '22222222-2222-4222-8222-222222222222', email: payload.email } }, error: null };
    },
    async signOut() {
      calls.push({ method: 'signOut' });
      emit('SIGNED_OUT', null);
      return { error: null };
    },
    async signInWithOAuth(payload) {
      calls.push({ method: 'signInWithOAuth', payload });
      return { data: {}, error: null };
    },
    async resetPasswordForEmail(email, options) {
      calls.push({ method: 'resetPasswordForEmail', email, options });
      return { data: {}, error: null };
    },
    async updateUser(payload) {
      calls.push({ method: 'updateUser', payload });
      emit('USER_UPDATED', window.__slevaoAuthTestInitialSession || null);
      return { data: { user: {} }, error: null };
    },
    onAuthStateChange(listener) {
      listeners.push(listener);
      window.__slevaoAuthListeners = listeners;
      queueMicrotask(() => listener('INITIAL_SESSION', window.__slevaoAuthTestInitialSession || null));
      return { data: { subscription: { unsubscribe() {} } } };
    }
  };

  const client = {
    auth,
    from() { return query(); },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    async removeChannel() { return 'ok'; },
    rpc() { return query(); }
  };

  window.__slevaoCreateClientCalls = 0;
  window.supabase = {
    createClient() {
      window.__slevaoCreateClientCalls += 1;
      return client;
    }
  };
})();
`;

async function mockAuth(page, initialSession = null) {
  await page.addInitScript((session) => {
    window.__slevaoAuthTestInitialSession = session;
  }, initialSession);
  await page.route(CDN_PATTERN, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: MOCK_SUPABASE
  }));
}

async function openAccount(page) {
  await page.goto(`${BASE_URL}/ucet.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#accountMessage')).toBeAttached();
  await expect.poll(() => page.evaluate(() => Array.isArray(window.__slevaoAuthListeners) ? window.__slevaoAuthListeners.length : 0)).toBeGreaterThanOrEqual(2);
}

test('account restores one shared Supabase session and signs out cleanly', async ({ page }) => {
  await mockAuth(page, {
    user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'session-test@slevao.test' }
  });
  await openAccount(page);

  await expect(page.locator('#profileArea')).toBeVisible();
  await expect(page.locator('#authArea')).toBeHidden();
  await expect(page.locator('#accountEmail')).toHaveText('session-test@slevao.test');
  expect(await page.evaluate(() => window.__slevaoCreateClientCalls)).toBe(1);

  await page.locator('#logout').click();
  await expect(page.locator('#authArea')).toBeVisible();
  await expect(page.locator('#profileArea')).toBeHidden();
  await expect(page.locator('#accountMessage')).toContainText('odhlášen');
});

test('account login succeeds and registration waits for email confirmation', async ({ page }) => {
  await mockAuth(page);
  await openAccount(page);

  await page.locator('#loginEmail').fill('login-test@slevao.test');
  await page.locator('#loginPassword').fill('CorrectHorse9');
  await page.locator('#signIn').click();
  await expect(page.locator('#profileArea')).toBeVisible();
  await expect(page.locator('#accountEmail')).toHaveText('login-test@slevao.test');

  await page.locator('#logout').click();
  await expect(page.locator('#authArea')).toBeVisible();

  await page.locator('#registerEmail').fill('register-test@slevao.test');
  await page.locator('#registerPassword').fill('weak');
  await page.locator('#signUp').click();
  await expect(page.locator('#accountMessage')).toContainText('alespoň 10 znaků');
  expect(await page.evaluate(() => window.__slevaoAuthCalls.filter((call) => call.method === 'signUp').length)).toBe(0);

  await page.locator('#registerPassword').fill('StrongPass9');
  await page.locator('#signUp').click();
  await expect(page.locator('#authArea')).toBeHidden();
  await expect(page.locator('#accountMessage')).toContainText('Potvrď registraci v e-mailu');
  expect(await page.evaluate(() => window.__slevaoAuthCalls.filter((call) => call.method === 'signUp').length)).toBe(1);
});

test('password recovery requests link, handles recovery event and saves strong password', async ({ page }) => {
  await mockAuth(page);
  await openAccount(page);

  await page.locator('#loginEmail').fill('recovery-test@slevao.test');
  await page.locator('#forgotPassword').click();
  await expect(page.locator('#accountMessage')).toContainText('poslali jsme odkaz');

  const resetCall = await page.evaluate(() => window.__slevaoAuthCalls.find((call) => call.method === 'resetPasswordForEmail'));
  expect(resetCall.email).toBe('recovery-test@slevao.test');
  expect(resetCall.options.redirectTo).toContain('/ucet.html?recovery=1');

  await page.evaluate(() => {
    const session = { user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'recovery-test@slevao.test' } };
    window.__slevaoAuthListeners.forEach((listener) => listener('PASSWORD_RECOVERY', session));
  });
  await expect(page.locator('#passwordRecoveryArea')).toBeVisible();
  await expect(page.locator('#authArea')).toBeHidden();

  await page.locator('#newPassword').fill('short');
  await page.locator('#newPasswordAgain').fill('short');
  await page.locator('#saveNewPassword').click();
  await expect(page.locator('#accountMessage')).toContainText('alespoň 10 znaků');
  expect(await page.evaluate(() => window.__slevaoAuthCalls.filter((call) => call.method === 'updateUser').length)).toBe(0);

  await page.locator('#newPassword').fill('NewStrongPass9');
  await page.locator('#newPasswordAgain').fill('NewStrongPass9');
  await page.locator('#saveNewPassword').click();
  await expect(page.locator('#passwordRecoveryArea')).toBeHidden();
  await expect(page.locator('#authArea')).toBeVisible();
  await expect(page.locator('#accountMessage')).toContainText('Heslo bylo změněno');
  expect(await page.evaluate(() => window.__slevaoAuthCalls.filter((call) => call.method === 'updateUser').length)).toBe(1);
});
