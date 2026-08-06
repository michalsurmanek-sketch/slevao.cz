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

    button.textContent = 'Smazat vše (obnovitelné)';
    button.title = 'Přesune všechny nabídky do koše a uloží jejich původní stav. Kompletní kontrola je obnoví pouze u úspěšně ověřených obchodů.';
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
      if (!confirm('Opravdu chceš přesunout VŠECHNY nabídky všech obchodů do koše? Letáky, produkty a fotografie zůstanou zachované. Následující kompletní kontrola obnoví jen nabídky obchodů, které úspěšně ověří.')) return;

      const phrase = prompt('Pro potvrzení napiš přesně: SMAZAT VŠECHNY NABÍDKY');
      if (phrase !== 'SMAZAT VŠECHNY NABÍDKY') {
        showMessage('Akce byla zrušena.', 'warning');
        return;
      }

      button.disabled = true;
      showMessage('Přesouvám všechny nabídky do obnovitelného koše…', 'warning');
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
        showMessage(`Do koše bylo přesunuto ${moved} nabídek. Pro jejich bezpečné obnovení otevři Automatizaci letáků a spusť kompletní kontrolu všech zdrojů.`, 'ok');
        setTimeout(() => reloadButton.click(), 400);
      } catch (error) {
        console.error('Hromadné smazání nabídek selhalo:', error);
        showMessage(error?.message || 'Hromadné mazání selhalo.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
})();
