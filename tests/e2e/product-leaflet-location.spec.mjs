import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const PRODUCT_ID = 'e2e-product';
const LIDL_PDF = 'https://assets.leaflets.schwarz/leaflets/pdfs/01a0433c-728c-7e2a-a184-522a753ade1b/Akcni-letak-OD-PONDELI-31-8-2-9-2026-00.pdf';

async function mountLeafletLocationHarness(page, offer, locations = []) {
  await page.goto(`${BASE_URL}/offline.html?id=${PRODUCT_ID}`, { waitUntil: 'domcontentloaded' });
  await page.setContent(`
    <main>
      <div id="offers">
        <article class="sfOffer">
          <div class="sfOfferActions">
            <button type="button" data-add-offer="${offer.id}">Přidat</button>
            <a class="sfButton" href="${LIDL_PDF}">Leták</a>
          </div>
        </article>
      </div>
    </main>
  `);

  await page.evaluate(({ mockedOffer, mockedLocations }) => {
    const query = (rows) => {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
      };
      return chain;
    };

    window.supabase = {
      createClient() {
        return {
          from(table) {
            return query(table === 'public_product_leaflet_locations' ? mockedLocations : []);
          },
        };
      },
    };
    window.__slevaoProductOffersPromise = Promise.resolve({ rows: [mockedOffer], error: null });
  }, { mockedOffer: offer, mockedLocations: locations });

  await page.addScriptTag({ url: `${BASE_URL}/assets/product-leaflet-location-global.js?e2e=1` });
  return page.locator('#offers a.sfButton');
}

test('Lidl verified v2 offer opens the exact official leaflet page', async ({ page }) => {
  const link = await mountLeafletLocationHarness(page, {
    id: 'lidl-page-25',
    store_id: 'lidl-store',
    valid_from: '2026-08-31',
    valid_to: '2026-09-02',
    source_url: LIDL_PDF,
    stores: { slug: 'lidl' },
    metadata: {
      adapter: 'lidl-verified-pdf-text-v2',
      leaflet_page: 25,
      leaflet_document_url: LIDL_PDF,
      leaflet_location_source: 'exact_import_mapping_v2',
    },
  });

  await expect(link).toHaveText('Leták · strana 25');
  await expect(link).toHaveAttribute('href', `${LIDL_PDF}#page=25&zoom=page-fit`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('data-exact-leaflet-location', '1');
  await expect(link).toHaveAttribute('aria-label', 'Ukázat produkt v letáku na straně 25');
});

test('unresolved Lidl offer never fabricates a leaflet page', async ({ page }) => {
  const sourceUrl = 'https://www.lidl.cz/c/akcni-nabidka/s10068317';
  const link = await mountLeafletLocationHarness(page, {
    id: 'lidl-unresolved',
    store_id: 'lidl-store',
    valid_from: '2026-08-31',
    valid_to: '2026-09-02',
    source_url: sourceUrl,
    stores: { slug: 'lidl' },
    metadata: {
      adapter: 'lidl-verified-pdf-text-v2',
      leaflet_location_source: null,
    },
  });

  await expect(link).toHaveText('Zobrazit nabídku');
  await expect(link).toHaveAttribute('href', sourceUrl);
  await expect(link).not.toHaveAttribute('data-exact-leaflet-location', '1');
  await expect(link).not.toHaveAttribute('href', /#page=/);
});
