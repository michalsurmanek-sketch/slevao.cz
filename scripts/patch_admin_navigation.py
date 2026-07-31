from pathlib import Path

p = Path('admin.html')
s = p.read_text(encoding='utf-8')

old_nav = '<nav class="nav"><button class="active" data-page="dashboard">Přehled</button><button data-page="offersPage">Nabídky</button><button data-page="storesPage">Obchody</button><button data-page="categoriesPage">Kategorie</button><a class="automation" href="admin-automatizace.html">⚙ Automatizace letáků</a></nav>'
new_nav = '<nav class="nav"><button class="active" data-page="dashboard">🏠 Přehled</button><button data-page="offersPage">🏷️ Nabídky</button><button data-page="storesPage">🏪 Obchody</button><button data-page="categoriesPage">📂 Kategorie</button><a href="admin-automatizace.html">⚙️ Automatizace</a><a href="admin-fotografie.html">🖼️ Fotografie produktů</a><a href="admin-pridat-fotografii.html">➕ Přidat fotografii</a><a href="admin-tesco-kontrola.html">🛒 Kontrola Tesco</a><a href="index.html">🌐 Otevřít web</a></nav>'
if old_nav not in s:
    raise SystemExit('sidebar nav anchor not found')
s = s.replace(old_nav, new_nav, 1)

old_top = '<div class="toolbar"><a href="admin-automatizace.html" class="btn primary">Automatizace</a><a href="index.html" class="btn light">Zobrazit web</a><button id="logout" class="btn light" type="button">Odhlásit</button></div>'
new_top = '<div class="toolbar"><a href="admin-automatizace.html" class="btn primary">Automatizace</a><a href="admin-fotografie.html" class="btn light">Fotografie</a><a href="admin-pridat-fotografii.html" class="btn light">Přidat foto</a><a href="index.html" class="btn light">Zobrazit web</a><button id="logout" class="btn light" type="button">Odhlásit</button></div>'
if old_top not in s:
    raise SystemExit('top toolbar anchor not found')
s = s.replace(old_top, new_top, 1)

old_mobile = '<nav class="mobilebar"><button data-page="dashboard">Přehled</button><button data-page="offersPage">Nabídky</button><a href="admin-automatizace.html">Automatizace</a><button data-page="storesPage">Obchody</button><button data-page="categoriesPage">Kategorie</button></nav>'
new_mobile = '<nav class="mobilebar"><button data-page="dashboard">🏠<span>Přehled</span></button><button data-page="offersPage">🏷️<span>Nabídky</span></button><a href="admin-automatizace.html">⚙️<span>Auto</span></a><a href="admin-fotografie.html">🖼️<span>Fotky</span></a><a href="admin-pridat-fotografii.html">➕<span>Přidat</span></a></nav>'
if old_mobile not in s:
    raise SystemExit('mobile nav anchor not found')
s = s.replace(old_mobile, new_mobile, 1)

# Add a quick links block to dashboard.
dash_anchor = '<div class="card" style="margin-top:16px"><h2>Nejnovější nabídky</h2><div id="recent" class="list"></div></div>'
quick = '<div class="card" style="margin-top:16px"><h2>Rychlé odkazy</h2><div class="toolbar"><a class="btn primary" href="admin-automatizace.html">⚙️ Automatizace letáků</a><a class="btn light" href="admin-fotografie.html">🖼️ Schvalování fotografií</a><a class="btn light" href="admin-pridat-fotografii.html">➕ Přidat fotografii</a><a class="btn light" href="admin-tesco-kontrola.html">🛒 Kontrola Tesco</a><a class="btn light" href="index.html">🌐 Otevřít ostrý web</a></div></div>'+dash_anchor
if dash_anchor not in s:
    raise SystemExit('dashboard anchor not found')
s = s.replace(dash_anchor, quick, 1)

# Improve sidebar scrolling for more links.
s = s.replace('.side{position:sticky;top:0;height:100vh;background:#102524;color:#fff;padding:20px 14px;display:flex;flex-direction:column}', '.side{position:sticky;top:0;height:100vh;background:#102524;color:#fff;padding:20px 14px;display:flex;flex-direction:column;overflow-y:auto}', 1)

p.write_text(s, encoding='utf-8')
print('admin.html navigation patched')
