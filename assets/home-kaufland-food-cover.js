(() => {
  'use strict';

  // Kaufland už spravuje společný renderer assets/home-leaflet-covers.js.
  // Tento dřívější doplněk přepisoval obrázek a popisky karty po vykreslení,
  // což způsobovalo přeskakování mezi „Aktuální leták“ a „Potravinový leták“.
  // Soubor zůstává jako bezpečný prázdný kompatibilní vstup pro starší HTML cache.
})();
