(() => {
  'use strict';

  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const CONFIG = {
    pivo: { label:'Pivo', title:'Pivo v akci', info:'Zobrazujeme jen pivo a pivní nápoje podle zvoleného filtru', icon:'🍺', types:[['pivo','Vše'],['lezak','Ležáky'],['vycepni pivo','Výčepní'],['nealkoholicke pivo','Nealkoholické'],['radler','Radlery']], forms:[['pivo','Všechna','♧'],['pivo plech','Plechovky','▣'],['pivo lahev','Lahve','◒'],['multipack pivo','Multipacky','▱']] },
    mleko: { label:'Mléko', title:'Mléko v akci', info:'Zobrazujeme mléko a alternativní nápoje podle zvoleného filtru', icon:'🥛', types:[['mleko','Vše'],['plnotucne mleko','Plnotučné'],['polotucne mleko','Polotučné'],['bezlaktozove mleko','Bez laktózy'],['rostlinny napoj','Rostlinné']], forms:[['mleko','Všechna','♧'],['cerstve mleko','Čerstvé','◒'],['trvanlive mleko','Trvanlivé','▱'],['kondenzovane mleko','Kondenzované','◉']] },
    pecivo: { label:'Pečivo', title:'Pečivo v akci', info:'Zobrazujeme jen pečivo a pekařské výrobky podle zvoleného filtru', icon:'🥖', types:[['pecivo','Vše'],['chleb','Chléb'],['rohliky','Rohlíky'],['housky','Housky'],['bagety','Bagety'],['sladke pecivo','Sladké']], forms:[['pecivo','Všechno','♧'],['cerstve pecivo','Čerstvé','◒'],['balene pecivo','Balené','▱'],['bezlepkove pecivo','Bezlepkové','◎']] },
    vejce: { label:'Vejce', title:'Vejce v akci', info:'Zobrazujeme jen skutečná vejce podle zvoleného filtru', icon:'🥚', types:[['vejce','Vše'],['slepici vejce','Slepičí'],['krepelci vejce','Křepelčí'],['vejce m','Velikost M'],['vejce l','Velikost L']], forms:[['vejce','Všechna','♧'],['vejce volny vybeh','Volný výběh','◒'],['vejce podestylka','Podestýlka','▱'],['bio vejce','Bio','◎']] },
    maslo: { label:'Máslo', title:'Máslo v akci', info:'Zobrazujeme jen skutečné máslo podle zvoleného filtru', icon:'🧈', types:[['maslo','Vše'],['klasicke maslo','Klasické'],['prepustene maslo','Přepuštěné'],['solene maslo','Solené'],['ochucene maslo','Ochucené']], forms:[['maslo','Všechna','♧'],['maslo kostka','Kostka','◒'],['maslo kelimek','Kelímek','▱']] },
    syr: { label:'Sýr', title:'Sýry v akci', info:'Zobrazujeme jen sýry a sýrové výrobky podle zvoleného filtru', icon:'🧀', types:[['syr','Vše'],['eidam','Eidam'],['gouda','Gouda'],['hermelin','Hermelín'],['mozzarella','Mozzarella'],['taveny syr','Tavené']], forms:[['syr','Všechny','♧'],['tvrdy syr','Tvrdé','◒'],['mekky syr','Měkké','▱'],['platkovy syr','Plátkové','▤'],['strouhany syr','Strouhané','◎']] },
    maso: { label:'Maso', title:'Maso v akci', info:'Zobrazujeme jen maso, ryby a masné výrobky podle zvoleného filtru', icon:'🥩', types:[['maso','Vše'],['veprove','Vepřové'],['kureci','Kuřecí'],['hovezi','Hovězí'],['kruti','Krůtí'],['mlete','Mleté'],['ryby','Ryby']], forms:[['cerstve maso','Čerstvé','♧'],['mrazene maso','Mražené','❄'],['uzeniny','Uzeniny','◒'],['marinovane maso','Marinované','♨']] },
    ovoce: { label:'Ovoce', title:'Ovoce v akci', info:'Zobrazujeme ovoce a ovocné nápoje podle zvoleného filtru', icon:'🍎', types:[['ovoce','Vše'],['jablka','Jablka'],['banany','Banány'],['citrusy','Citrusy'],['bobulove','Bobulové'],['exoticke','Exotické']], forms:[['ovoce','Čerstvé','♧'],['mrazene ovoce','Mražené','❄'],['susene ovoce','Sušené','◒'],['ovocne napoje','Nápoje','▱']] },
    zelenina: { label:'Zelenina', title:'Zelenina v akci', info:'Zobrazujeme zeleninu a zeleninové výrobky podle zvoleného filtru', icon:'🥕', types:[['zelenina','Vše'],['brambory','Brambory'],['rajcata','Rajčata'],['papriky','Papriky'],['cibule','Cibule'],['korenova zelenina','Kořenová'],['listova zelenina','Listová']], forms:[['zelenina','Čerstvá','♧'],['mrazena zelenina','Mražená','❄'],['sterilovana zelenina','Sterilovaná','◒'],['zeleninove vyrobky','Výrobky','▱']] }
  };
  const ALIASES = new Map();
  Object.entries(CONFIG).forEach(([base, config]) => {
    ALIASES.set(base, base);
    [...config.types, ...config.forms].forEach(([query]) => ALIASES.set(fold(query), base));
  });

  const search = () => document.getElementById('sideSearch');
  const currentQuery = () => fold(search()?.value || document.getElementById('q')?.value || '');
  const selectQuery = (query) => {
    const input = search();
    if (!input) return;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    const top = document.getElementById('q');
    if (top) top.value = query;
  };

  function countFromToolbar() {
    const text = document.getElementById('resultText')?.textContent || '';
    if (/žádná odpovídající nabídka/i.test(text)) return 0;
    const match = text.match(/z\s+(\d[\d\s]*)\s+nab/i) || text.match(/(\d[\d\s]*)\s+nab/i);
    return match ? Number(match[1].replace(/\s/g,'')) : null;
  }

  function countLabel(count) {
    if (!Number.isFinite(count)) return '— nabídek';
    if (count === 1) return '1 nabídka';
    if (count >= 2 && count <= 4) return `${count} nabídky`;
    return `${count} nabídek`;
  }

  function ensurePanel() {
    const quickTabs = document.getElementById('quickTabs');
    if (!quickTabs) return null;
    let panel = document.getElementById('slSemanticPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'slSemanticPanel';
      panel.className = 'slSemanticPanel';
      panel.setAttribute('aria-label','Podrobné filtrování kategorie');
      quickTabs.parentNode.insertBefore(panel, quickTabs);
      panel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-semantic-query]');
        if (button) selectQuery(button.dataset.semanticQuery || '');
      });
    }
    return panel;
  }

  function render() {
    const query = currentQuery();
    const base = ALIASES.get(query);
    const deals = document.getElementById('dealsSection');
    const panel = ensurePanel();
    if (!deals || !panel) return;
    if (!base) {
      deals.classList.remove('slSemanticActive');
      panel.dataset.semanticBase = '';
      panel.hidden = true;
      document.dispatchEvent(new CustomEvent('slevao:semantic-filter', { detail:{ base:'' } }));
      return;
    }
    const config = CONFIG[base];
    const count = countFromToolbar();
    const selected = [...config.types, ...config.forms].find(([value]) => query === fold(value));
    const selectedLabel = selected?.[1] || 'Vše';
    deals.classList.add('slSemanticActive');
    panel.dataset.semanticBase = base;
    panel.hidden = false;
    const title = document.getElementById('dealsTitle');
    const subtitle = document.getElementById('dealsSubtitle');
    if (title && title.textContent !== config.title) title.textContent = config.title;
    if (subtitle && subtitle.textContent !== 'Vyber druh nebo formu. Výsledky řadíme podle ceny, úspory a platnosti.') subtitle.textContent = 'Vyber druh nebo formu. Výsledky řadíme podle ceny, úspory a platnosti.';
    panel.innerHTML = `
      <div class="slSemanticMeta"><span>${config.icon} ${config.label}</span><i></i><span>${selectedLabel}</span><i></i><strong>${countLabel(count)}</strong></div>
      <div class="slSemanticRow slSemanticTypes" role="group" aria-label="Druh ${config.label.toLowerCase()}">
        ${config.types.map(([value,label]) => `<button type="button" data-semantic-query="${value}" class="${query === fold(value) ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <div class="slSemanticBottom">
        <div class="slSemanticRow slSemanticForms" role="group" aria-label="Forma produktu">
          ${config.forms.map(([value,label,icon]) => `<button type="button" data-semantic-query="${value}" class="${query === fold(value) ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}
        </div>
        <div class="slSemanticInfo"><span aria-hidden="true">♧</span>${config.info}</div>
      </div>`;
    document.dispatchEvent(new CustomEvent('slevao:semantic-filter', { detail:{ base } }));
  }

  function init() {
    ensurePanel();
    search()?.addEventListener('input', () => requestAnimationFrame(render));
    document.getElementById('q')?.addEventListener('change', () => requestAnimationFrame(render));
    const observed = document.getElementById('resultText');
    if (observed) new MutationObserver(() => requestAnimationFrame(render)).observe(observed, { childList:true, subtree:true, characterData:true });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();