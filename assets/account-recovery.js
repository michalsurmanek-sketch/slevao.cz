(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  function message(text, bad = false) {
    const target = $('accountMessage');
    if (!target) return;
    target.textContent = text;
    target.style.color = bad ? '#b32631' : '#0b7a58';
  }

  function strongPassword(password) {
    return password.length >= 10
      && /[a-zá-ž]/.test(password)
      && /[A-ZÁ-Ž]/.test(password)
      && /\d/.test(password);
  }

  function passwordPolicyMessage() {
    return 'Heslo musí mít alespoň 10 znaků, malé a velké písmeno a číslo.';
  }

  function showRecoveryForm() {
    const panel = $('passwordRecoveryArea');
    const auth = $('authArea');
    if (panel) panel.hidden = false;
    if (auth) auth.hidden = true;
    document.body.classList.add('accountPasswordRecovery');
  }

  function clearRecoveryUrl() {
    const next = new URL(location.href);
    next.searchParams.delete('recovery');
    next.hash = '';
    history.replaceState(null, '', `${next.pathname}${next.search}${next.hash}`);
  }

  async function requestReset() {
    const email = String($('loginEmail')?.value || '').trim();
    if (!email || !email.includes('@')) {
      message('Nejdřív zadej e-mail svého účtu.', true);
      $('loginEmail')?.focus();
      return;
    }

    const button = $('forgotPassword');
    if (button) button.disabled = true;
    const redirectTo = new URL('ucet.html?recovery=1', location.href).href;
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
    if (button) button.disabled = false;
    if (error) {
      message(`Odkaz pro změnu hesla se nepodařilo odeslat: ${error.message}`, true);
      return;
    }
    message('Pokud účet s tímto e-mailem existuje, poslali jsme odkaz pro nastavení nového hesla.');
  }

  async function savePassword() {
    const password = String($('newPassword')?.value || '');
    const confirmation = String($('newPasswordAgain')?.value || '');
    if (!strongPassword(password)) {
      message(passwordPolicyMessage(), true);
      return;
    }
    if (password !== confirmation) {
      message('Zadaná hesla se neshodují.', true);
      return;
    }

    const button = $('saveNewPassword');
    if (button) button.disabled = true;
    const { error } = await db.auth.updateUser({ password });
    if (error) {
      if (button) button.disabled = false;
      message(`Heslo se nepodařilo změnit: ${error.message}`, true);
      return;
    }

    await db.auth.signOut();
    clearRecoveryUrl();
    document.body.classList.remove('accountPasswordRecovery');
    if ($('passwordRecoveryArea')) $('passwordRecoveryArea').hidden = true;
    if ($('authArea')) $('authArea').hidden = false;
    if ($('newPassword')) $('newPassword').value = '';
    if ($('newPasswordAgain')) $('newPasswordAgain').value = '';
    message('Heslo bylo změněno. Přihlas se novým heslem.');
  }

  function enforceRegistrationPassword(event) {
    const password = String($('registerPassword')?.value || '');
    if (strongPassword(password)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    message(passwordPolicyMessage(), true);
    $('registerPassword')?.focus();
  }

  $('signUp')?.addEventListener('click', enforceRegistrationPassword, true);
  $('forgotPassword')?.addEventListener('click', requestReset);
  $('saveNewPassword')?.addEventListener('click', savePassword);

  const recoveryRequested = params.get('recovery') === '1' || /(?:^|[&#])type=recovery(?:&|$)/.test(location.hash);
  if (recoveryRequested) showRecoveryForm();

  db.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showRecoveryForm();
  });
})();