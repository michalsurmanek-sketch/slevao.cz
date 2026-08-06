(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';

  window.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabase) return;

    const reloadButton = document.getElementById('reload');
    const actions = reloadButton?.parentElement;
    if (!reloadButton || !actions) return;

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: sessionData } = await db.auth.getSession();
    const session = sessionData.session;
    const role = String(session?.user?.app_metadata?.role || '').toLowerCase();
    if (!session || role !== 'admin') return;

    let button = document.getElementById('trashAllOffers');
    if (!button) {
      button = document.createElement('button');
      button.id = 'trashAllOffers';
      button.type = 'button';
      button.className = 'btn danger';
    }

    button.textContent = 'Smazat vše';
    button.title = 'Přesune všechny nabídky do obnovitelného koše a automaticky spustí kompletní kontrolu zdrojů.';
    button.style.background = '#dc2638';
    button.style.borderColor = '#dc2638';
    button.style.color = '#fff';
    actions.insertBefore(button, reloadButton);

    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';

    const showMessage = (text, type = 'ok') => {
      const box = document.getElementById('pageMessage');
      if (!box) return;
      box.textContent = text;
      box.className = `notice ${type}`;
      box.classList.remove('hidden');
    };

    button.addEventListener('click', async () => {
      if (!confirm('Opravdu chceš dočasně přesunout VŠECHNY nabídky do koše? Automatická kontrola zdrojů se spustí ihned a platné nabídky se po ověření samy vrátí.')) return;

      const phrase = prompt('Pro potvrzení napiš přesně: SMAZAT VŠECHNY NABÍDKY');
      if (phrase !== 'SMAZAT VŠECHNY NABÍDKY') {
        showMessage('Akce byla zrušena.', 'warning');
        return;
      }

      button.disabled = true;
      showMessage('Přesouvám nabídky do koše a spouštím automatickou kontrolu všech zdrojů…', 'warning');
      try {
        const { data, error } = await db.functions.invoke('trash-all-offers', {
          body: { confirmation: 'SMAZAT VŠECHNY NABÍDKY' },
        });
        if (error || !data?.ok) throw new Error(error?.message || data?.error || 'Hromadné mazání selhalo.');

        try {
          Object.keys(localStorage)
            .filter((key) => key.startsWith('slevao-public-data-'))
            .forEach((key) => localStorage.removeItem(key));
        } catch {}

        const moved = Number(data.moved_to_trash || 0).toLocaleString('cs-CZ');
        if (data.automatic_scan_started) {
          showMessage(`Do koše bylo přesunuto ${moved} nabídek. Automatická kontrola všech zdrojů už běží a platné nabídky se po ověření samy vrátí.`, 'ok');
        } else {
          showMessage(`Do koše bylo přesunuto ${moved} nabídek, ale automatickou kontrolu se nepodařilo spustit: ${data.automatic_scan_error || 'neznámá chyba'}`, 'error');
        }
        setTimeout(() => reloadButton.click(), 1500);
        setTimeout(() => reloadButton.click(), 7000);
        setTimeout(() => reloadButton.click(), 15000);
      } catch (error) {
        console.error('Hromadné smazání nabídek selhalo:', error);
        showMessage(error?.message || 'Hromadné mazání selhalo.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
})();
