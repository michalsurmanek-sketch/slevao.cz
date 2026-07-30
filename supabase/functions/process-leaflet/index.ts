import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';
const STORAGE_BUCKET = Deno.env.get('LEAFLET_BUCKET') || 'leaflets';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ExtractedItem = {
  title: string;
  brand: string | null;
  quantity_text: string | null;
  price: number | null;
  old_price: number | null;
  unit_price: number | null;
  unit_label: string | null;
  image_url: string | null;
  source_page: number | null;
  confidence: number | null;
  category_name: string | null;
};

type ExtractionResult = {
  valid_from: string | null;
  valid_to: string | null;
  page_count: number | null;
  items: ExtractedItem[];
};

function runInBackground(task: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else task.catch((error) => console.error('Background task failed:', error));
}

async function markFailed(importId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Import failed', importId, message);
  await db.from('leaflet_imports').update({
    status: 'failed',
    error_message: message.slice(0, 2000),
    finished_at: new Date().toISOString(),
  }).eq('id', importId);
}

async function ensureBucket() {
  const { data } = await db.storage.getBucket(STORAGE_BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (error) throw error;
  }
}

async function categoryMap() {
  const { data, error } = await db.from('categories').select('id,name');
  if (error) throw error;
  return new Map((data || []).map((row: any) => [String(row.name).toLocaleLowerCase('cs'), row.id]));
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text;
    }
  }
  return '';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function detectDocumentType(contentType: string, bytes: Uint8Array) {
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  if (normalized === 'application/pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { extension: 'pdf', mime: 'application/pdf' };
  }
  if (normalized === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (normalized === 'image/webp' || (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) {
    return { extension: 'webp', mime: 'image/webp' };
  }
  if (normalized === 'image/gif' || (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)) {
    return { extension: 'gif', mime: 'image/gif' };
  }
  if (normalized === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }
  throw new Error(`Stažená adresa nevrátila platný PDF ani obrázek. Content-Type: ${contentType || 'neuveden'}`);
}

async function uploadPdfToOpenAI(bytes: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new Error(`Nahrání PDF do OpenAI selhalo: ${payload?.error?.message || `HTTP ${response.status}`}`);
  }
  return String(payload.id);
}

async function extractWithOpenAI(
  storeName: string,
  extension: string,
  mime: string,
  bytes: Uint8Array,
  importId: string,
): Promise<ExtractionResult> {
  if (!OPENAI_API_KEY) throw new Error('V Supabase chybí secret OPENAI_API_KEY.');

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['valid_from', 'valid_to', 'page_count', 'items'],
    properties: {
      valid_from: { type: ['string', 'null'] },
      valid_to: { type: ['string', 'null'] },
      page_count: { type: ['integer', 'null'] },
      items: {
        type: 'array',
        maxItems: 300,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'brand', 'quantity_text', 'price', 'old_price', 'unit_price', 'unit_label', 'image_url', 'source_page', 'confidence', 'category_name'],
          properties: {
            title: { type: 'string' },
            brand: { type: ['string', 'null'] },
            quantity_text: { type: ['string', 'null'] },
            price: { type: ['number', 'null'] },
            old_price: { type: ['number', 'null'] },
            unit_price: { type: ['number', 'null'] },
            unit_label: { type: ['string', 'null'] },
            image_url: { type: ['string', 'null'] },
            source_page: { type: ['integer', 'null'] },
            confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
            category_name: { type: ['string', 'null'] },
          },
        },
      },
    },
  };

  let documentInput: Record<string, unknown>;
  if (extension === 'pdf') {
    const fileId = await uploadPdfToOpenAI(bytes, `letak-${importId}.pdf`);
    documentInput = { type: 'input_file', file_id: fileId };
  } else {
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    documentInput = { type: 'input_image', image_url: dataUrl, detail: 'high' };
  }

  const aiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      store: false,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Zpracuj český akční leták obchodu ${storeName || 'neuvedený obchod'}. Vrať všechny skutečné produktové nabídky. Ceny uváděj jako čísla v Kč bez měnového symbolu. Starou cenu vyplň jen pokud je v letáku výslovně uvedena. Množství zachovej například jako 500 g, 1 l nebo 10 ks. Kategorie používej stručné české názvy jako Potraviny, Nápoje, Drogerie, Domácnost, Elektronika, Oblečení, Zahrada, Chovatelské potřeby. Neodhaduj chybějící údaje. Nevytvářej produkty z nadpisů, kupónů, věrnostních bodů ani obecných reklamních textů. Confidence sniž při nejasné ceně nebo názvu.${storeName.toLocaleLowerCase('cs').includes('makro') ? ' U MAKRO vždy použij jako price konečnou cenu s DPH. Menší cenu bez DPH a větší cenu s DPH nikdy nevykládej jako akční a původní cenu; old_price v takovém případě musí být null.' : ''}`,
        }, documentInput],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'slevao_leaflet_v1',
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await aiResponse.json().catch(() => ({}));
  if (!aiResponse.ok) throw new Error(`OpenAI zpracování selhalo: ${payload?.error?.message || `HTTP ${aiResponse.status}`}`);
  const text = responseText(payload);
  if (!text) throw new Error('OpenAI nevrátila strukturovaný výsledek.');
  try { return JSON.parse(text) as ExtractionResult; }
  catch { throw new Error('OpenAI vrátila neplatný JSON.'); }
}



const BILLA_IMAGE_BY_TITLE = new Map<string, string>([
  [
    "veprova kyta bez kosti",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/020e437c-e74b-43e0-9133-9868444ef09c/68849906-4cc0-47e1-9c09-35ab5999a6c0_1991338358.jpeg?w=500"
  ],
  [
    "magnum nanuk",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/873c2870-e766-4c78-bb37-2b761d6d8ac8/81a5e3e4-2da8-4cc9-88bb-98fa53fc3f8c_2010089195.jpeg?w=500"
  ],
  [
    "nowaco file porce msc",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/52186b17-10b8-4330-a9f1-97856917ccc8/2eed35c5-d067-485a-8e9d-03453d61cf81_1348029786.jpeg?w=500"
  ],
  [
    "boruvky",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/b84ad6a7-19da-41f3-a3b2-909d201ec0fd/1dd10ae2-7d4c-4be6-a120-6444d82464a4_1478619578.jpeg?w=500"
  ],
  [
    "magnum pint 440 ml",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/3a2fc66e-316d-47ba-ab34-4c7dd89eaee4/4a49f438-f6b1-4e01-80f0-5d83b0b84bd1_1137021950.jpeg?w=500"
  ],
  [
    "kureci rizky prsni",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/1dae57c6-d11f-4cfc-8d14-34d3b8685e8c/8e87c368-b188-44b5-85ba-6a6ecf2766ea_1794428997.jpeg?w=500"
  ],
  [
    "babicciny testoviny vajecne",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/4b05f2b4-c588-40f6-82cf-13bdc863948b/5856aaff-cdbf-4061-b3c7-c5d1a58bb9f1_1457543959.jpeg?w=500"
  ],
  [
    "milko maslo",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/882cc963-b022-4700-9024-4bf4c55f9ba9/0ce42b6f-9cc6-4409-a638-4adf5a2d40bf_2046288442.jpeg?w=500"
  ],
  [
    "gemerka",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/4d65295e-796a-44f4-aa45-113a24f29492/4d1860c2-36c4-4de3-98d6-7c49a8bd2661_951649151.jpeg?w=500"
  ],
  [
    "svestky volne",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/d8dc51a3-67f3-489e-9229-b61db00a139a/8caf9581-9ff1-4d35-9c2b-903e48d8f0cd_1486138815.jpeg?w=500"
  ],
  [
    "activia",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/871f0fbd-efc3-4784-ba6e-809d5ef5b004/8d08419f-048e-461e-8444-e86f29c9c381_1505553318.jpeg?w=500"
  ],
  [
    "kabanos exclusive",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/8764c0d4-4099-4caf-9dc8-8c9ff5f79a0c/099f35de-a8f6-457d-92c8-f15676d21b38_187808136.jpeg?w=500"
  ],
  [
    "meloun vodni se snizenym obsahem semen",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/27d9d03a-6d7d-473d-8ab1-136595a0adba/cb4dc9fe-af72-46f5-9178-fbadd3aa2cc9_1313614292.jpeg?w=500"
  ],
  [
    "pomeranc",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/c9e6115a-b71b-4753-9db8-15fa7c412002/d4fe5680-8b60-4ab6-a2f1-4d7ff3a271b7_1271024454.jpeg?w=500"
  ],
  [
    "vejce m podestylkova",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/19bddc1d-e93c-43b9-9bfa-0342e778c1b0/b09fa217-7d8c-4979-b3e2-c2b001477e4a.jpeg?w=500"
  ],
  [
    "jihocesky tvaroh polotucny",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/4b5cc06f-ed76-429a-9594-300f78b9065d/4046ec93-d512-45c7-99e4-6837ce7c5054_1272116368.jpeg?w=500"
  ],
  [
    "nice bites pistacie prazene solene",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/3125e2d4-30f6-4729-be51-ef7b94a08896/cf9288e2-aaf0-4662-8899-7f9bf2b50e99_1985562440.jpeg?w=500"
  ],
  [
    "donut s jahodovou polevou",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/2df148bf-ab85-4a6f-aef3-52d0ed174bf7/4c71e7fd-c7cb-435a-ae99-1536ed3738ad_719275835.jpeg?w=500"
  ],
  [
    "hovezi gulas porcovany",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/3a311727-8ee8-4931-b927-583fae980532/4e7effb2-c663-4e1a-b9c2-4f1141622955_856369638.jpeg?w=500"
  ],
  [
    "monte snack",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/85cebef1-2eee-46bc-8685-579cab6816b0/2de7eb5a-91e2-4085-a32c-e51e0f3991a5_1590806353.jpeg?w=500"
  ],
  [
    "kedlubna",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/11e80b04-0c09-413a-8f8c-43292d8fc956/0c9295c2-f2ba-4a60-96f6-96e924f2dd30_662356509.jpeg?w=500"
  ],
  [
    "poctiva sunka z pultu lahudek",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/b2c9dfd9-8c0d-4fa3-918f-9c78ebd62e32/e03ee7fd-7ef5-42b7-90e8-c441ba34d82f_314659344.jpeg?w=500"
  ],
  [
    "actimel 12 100 g",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/bdf39fff-01b3-4451-91a8-fcd34e9f57a3/48fcc07b-9635-4e17-8c64-b9a16e4a48c2_1015483807.jpeg?w=500"
  ],
  [
    "milka cokolada",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/06b74d3f-6bd8-45e1-8fb6-c52292854969/b1f8cebf-fcca-4126-b03a-21b3ea879689_530812285.jpeg?w=500"
  ],
  [
    "kureci ctvrtky",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/4247578d-d6a9-4981-a323-1ad0595a67a8/969fac4b-28e1-4af2-94cb-d23e592ea3a2_908022659.jpeg?w=500"
  ],
  [
    "jablko golden delicious",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/ae8e3c0b-3724-4170-b3bf-e2493a5a18e2/54be1b67-66c4-44b5-8193-810759595e86_515899824.jpeg?w=500"
  ],
  [
    "ostruziny",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/303a524e-2674-4a92-90c7-c0e97325a538/026fc772-64e8-4112-9346-8324850a9f1f_155018035.jpeg?w=500"
  ],
  [
    "vocilka spekacky",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/5d102103-974a-490c-b7d8-62bae6388e62/636afca7-ecad-4693-aecd-4d7547717949_1378529470.jpeg?w=500"
  ],
  [
    "krevety varene loupane",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/27fd1b66-166d-473a-985b-8fc3b8905661/d7ed3f45-ebbd-4d75-8172-7c786060ee48_1386613966.jpeg?w=500"
  ],
  [
    "chaluparsky bochnik",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/1ef07f24-f945-4387-9138-da2a4365c1a8/6ca7c867-895b-4943-9a74-52139186786e_105512089.jpeg?w=500"
  ],
  [
    "dynovy chleb kvaskovy",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/33c487b4-ac79-4817-a37d-146c99efb7a6/f0ea8c9f-79b5-4546-9c4e-ff7e3f2bd43e_359458541.jpeg?w=500"
  ],
  [
    "croissant s parkem",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/ece7b9eb-1109-4783-9fcb-347b4360388b/8caed4b8-6a24-4050-a270-28608adbe241_1340311438.jpeg?w=500"
  ],
  [
    "nekton losos uzeny",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/26e77bee-b26a-40b9-bf6e-d35ee5940bcb/b4c7c4c1-7ac5-40a6-8d89-16d37127e183_1775290673.jpeg?w=500"
  ],
  [
    "anglicka slanina special",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/0c5d691d-92d2-4c2e-9d5c-9cf4d7518f3f/140d43ae-33cf-4fe8-84db-b5e54f81e612_1736993505.jpeg?w=500"
  ],
  [
    "vincentka",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/52bfd3d7-0bf7-46d2-88e6-881f1e1dd526/2a4ba9f1-0575-4fa5-9608-e891e24c711f_1904340761.jpeg?w=500"
  ],
  [
    "rohlik s anglickou slaninou",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/587aecc0-50a4-4a29-9f38-bfc8f913124c/28e32533-4b74-40a5-ab2b-487d97c14c30_1776557630.jpeg?w=500"
  ],
  [
    "heinz kecup jemny",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/2cb35bca-93ea-4fa1-bd9b-428c2ecfccc3/81cafc79-eab4-4393-8a01-efdf5a3a03fc_877903662.jpeg?w=500"
  ],
  [
    "gambrinus original",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/deb1043b-6077-46d6-a162-b6dc2d0e9224/0cf7dc76-32ea-4652-9857-c14b36d57703_1191440403.jpeg?w=500"
  ],
  [
    "dr oetker pizza feliciana",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/df7a82ae-4f09-41e8-a62c-ea477f49c922/afe6075a-72ae-4e5c-8a21-cf844a3a0eb8_1634605082.jpeg?w=500"
  ],
  [
    "nescafe gold crema instantni kava",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/09c600e4-cee5-4c4e-ab40-ac496ec95b6c/74e96207-30fc-45f0-838f-bbe181ff63ab_1256360779.jpeg?w=500"
  ],
  [
    "podebradka ochucena",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/9047f656-b539-4f96-8bea-0de34872b0da/f67c1d4c-f518-4826-97c4-54983c89cdb8_347834432.jpeg?w=500"
  ],
  [
    "lagris pohanka xxl",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/86b46cd1-52bc-43a6-b493-f9b7f18edad8/fbc8fa6f-f86d-4361-9f51-8ef96b2d0fc8_1718993162.jpeg?w=500"
  ],
  [
    "menu gold ryze jasminova",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/bdbc4774-85c9-4e9e-abb9-1e6f3ae620f5/7f7c5672-7651-429e-be7f-d76a0ec2c3ab_2003101079.jpeg?w=500"
  ],
  [
    "persil prostredek na prani",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/bb406918-156e-4fb6-bcb3-381405b6b3c9/3979b91a-5b73-4a50-9f34-603e8d97e738_1586222171.jpeg?w=500"
  ],
  [
    "hanacka vodka",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/af1d9384-5ea0-4bd0-a6ec-1e8d2fad875c/4c84f0b1-9e4d-49a5-8e24-8645e5bf0c8a_622027711.jpeg?w=500"
  ],
  [
    "paprika zeleninova na leco sitka",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/2a254146-6db5-45ad-9113-5356e70db182/29a1c864-9313-4496-b0ab-8086a5ec4cf0_1770138109.jpeg?w=500"
  ],
  [
    "mletne maso veprove",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/5cff7b05-5b60-4748-8c06-0301b7412867/6c76b128-f80b-4031-8b78-6fbf71f41cc9_192646682.jpeg?w=500"
  ],
  [
    "melnene maso veprove mlete",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/5cff7b05-5b60-4748-8c06-0301b7412867/6c76b128-f80b-4031-8b78-6fbf71f41cc9_192646682.jpeg?w=500"
  ],
  [
    "magnum pint",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/3a2fc66e-316d-47ba-ab34-4c7dd89eaee4/4a49f438-f6b1-4e01-80f0-5d83b0b84bd1_1137021950.jpeg?w=500"
  ],
  [
    "broskve paraguayo",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/f0189a42-8638-47ab-9878-ed456a34b4a3/6c4045bd-5473-46b4-9ed9-d2d484b6e901_146062765.jpeg?w=500"
  ],
  [
    "svestky",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/d8dc51a3-67f3-489e-9229-b61db00a139a/8caf9581-9ff1-4d35-9c2b-903e48d8f0cd_1486138815.jpeg?w=500"
  ],
  [
    "pomeranc volny",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/c9e6115a-b71b-4753-9db8-15fa7c412002/d4fe5680-8b60-4ab6-a2f1-4d7ff3a271b7_1271024454.jpeg?w=500"
  ],
  [
    "srdce domova vejce m podestylkova",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/19bddc1d-e93c-43b9-9bfa-0342e778c1b0/b09fa217-7d8c-4979-b3e2-c2b001477e4a.jpeg?w=500"
  ],
  [
    "brick croissant",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/7bcd23f4-59d3-4570-a215-464da3da4906/cd891de7-8ef4-4c0e-9f16-fb8437f53f97_1435104628.jpeg?w=500"
  ],
  [
    "billa ready potato gnocchi",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/41ce39bc-ad44-430d-80e5-751ef0393d80/324a901e-91d7-4f48-b19c-b66febb17f92_829973610.jpeg?w=500"
  ],
  [
    "billa croquettes",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/d13c9d75-da0c-4516-b04d-6af00ab3133e/cba39fd7-5664-4f30-80ae-b1e5cf64280e_313592111.jpeg?w=500"
  ],
  [
    "haagen dazs multipack 4 95 ml",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/1530197d-4aac-47a4-8c54-2c3dc0d4a1ad/75dbdfc6-770d-48e1-bf11-17a80ab1bd26_544144699.jpeg?w=500"
  ],
  [
    "eduscho instantni kava",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/15dbe48b-e61d-4994-9100-88c9618552b0/4dda9db3-8b23-431c-aabb-486b98482ff9_1514751508.jpeg?w=500"
  ],
  [
    "tchibo espresso zrno",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/4abe5a55-9776-469e-8de5-9ce9b182ae47/46be8cca-7e6a-4df7-9f31-03856ff721c6_2037792380.jpeg?w=500"
  ],
  [
    "corny big cerealni tycinka",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/e5c45f73-29ca-4b46-a0b9-c2dd24651141/63ae34f4-00db-4621-a331-40573341a32f_2048586651.jpeg?w=500"
  ],
  [
    "marila standard mleta kava",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/908ef93f-8954-4978-bbef-13a06d2fb582/b4a4b3e1-2a9a-486c-9938-a13409b37053_833201803.jpeg?w=500"
  ],
  [
    "pfanner ledovy caj",
    "https://www.minimani.fi/media/catalog/product/cache/9b19c45c70084e218fc0ce0c3e43ed6e/a/2/a206b24e3470faa65b2dfbe32de3545ca876e330_9006900011512.jpg"
  ],
  [
    "milko recky jogurt 0",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/18515572-1a13-4d6f-827c-dd36cc5664e8/e33c7a9f-b00f-4355-bb29-b8b152caa16a_1597447296.jpeg?w=500"
  ],
  [
    "cibulka lahudkova",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-304648-0171512348-3d5jq2Yb-large.jpg"
  ],
  [
    "sunka nejvyssi jakosti z pultu lahudek",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-317109-432000175-xsiy0Co6-large.jpg"
  ],
  [
    "grill party bile klobasky",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-342035-1998604648-Olg_oHPN-large.jpg"
  ],
  [
    "billa olivovy olej extra panensky",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-366152-0175634158-pf9xUr_n.jpg"
  ],
  [
    "veprovy valecek falesna svickova vakuum",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-351507-1393556153-8nYrHyaz-medium.jpg"
  ],
  [
    "veprovy valecek falesna svickova",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-351507-1393556153-8nYrHyaz-medium.jpg"
  ],
  [
    "grill party mini berner parecky se syrem obalene slaninou",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-343291-0778637306-ZSFKECW3-large.jpg"
  ],
  [
    "philadelphia cottage",
    "https://livraricampina.ro/cdn/shop/products/9f337317de7be4b6a931ab6f11a6_530x%402x.jpg?v=1651596917"
  ],
  [
    "saturo nutricne kompletni jidlo",
    "https://saturo.com/cdn/shop/files/saturo-trinkmahlzeit-1x400ml-vanilla-packshot-0deg-dr006020010-whitebg-1024x1024px.jpg?v=1759413854&width=500"
  ],
  [
    "perla",
    "https://digitalcontent.api.tesco.com/v2/media/ghs/03075e47-7875-4547-a457-569ff51e0282/dd560cbc-1c2c-4c6e-a365-fb739bd0b9e9_685861521.jpeg?w=500"
  ],
  [
    "kureci stripsy obalovane z tepleho pultu",
    "https://karambapizza.cz/assets/images/e0aa3aef6870b9c87bc80b2e46ec916c/171-400.png"
  ],
  [
    "dr pekar bezlepkovy remeslny chleb",
    "https://www.rohlik.cz/cdn-cgi/image/f%3Dauto%2Cw%3D800%2Ch%3D800%2Cq%3D75/https%3A//cdn.rohlik.cz/images/grocery/products/1406182/1406182-1637774056969.jpg"
  ],
  [
    "aperol laurenza prosecco kombo",
    "https://www.elpalaciodehierro.com/dw/image/v2/BDKB_PRD/on/demandware.static/-/Sites-palacio-master-catalog/default/dw80b53670/images/44643486/large/44643486_x1.jpg?sh=1152&sw=960"
  ],
  [
    "aperol 0 7 l laurenza prosecco d o c 0 75 l kombo",
    "https://www.elpalaciodehierro.com/dw/image/v2/BDKB_PRD/on/demandware.static/-/Sites-palacio-master-catalog/default/dw80b53670/images/44643486/large/44643486_x1.jpg?sh=1152&sw=960"
  ],
  [
    "astra rezana 1 svazek",
    "https://media.loukykvet.app/e8ad6efb-8cc0-4c6d-bcb2-2e4939b29374/product-card.jpg"
  ],
  [
    "anturie mix kvetinac 14 cm",
    "https://bilder.obi.pl/745883f8-e59f-4ac0-b486-cb07c3a6ca09/pr08A/image.jpeg"
  ],
  [
    "billa toaletni papir",
    "https://images.cdn.europe-west1.gcp.commercetools.com/1df039f1-4705-4f79-aa90-cf907a6ec063/82-311354-0853575896-u331KK5e-medium.jpg"
  ]
]);

function normalizedImageTitle(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

async function enrichBillaImages(items: ExtractedItem[]): Promise<ExtractedItem[]> {
  const enriched = items.map((item) => {
    if (item.image_url) return item;
    const image = findBillaImage(item.title);
    return image ? { ...item, image_url: image } : item;
  });
  const missingIndexes = enriched.map((item, index) => item.image_url ? -1 : index).filter((index) => index >= 0);
  for (let offset = 0; offset < missingIndexes.length; offset += 4) {
    const batch = missingIndexes.slice(offset, offset + 4);
    const images = await Promise.all(batch.map((index) => findOfficialBillaImage(enriched[index].title)));
    images.forEach((image, position) => {
      if (image) enriched[batch[position]] = { ...enriched[batch[position]], image_url: image };
    });
  }
  return enriched;
}

function parseNuxtPayload(html: string): any {
  const match = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Stránka Globusu neobsahuje strukturovaná data.');
  const payload = JSON.parse(match[1]);
  const cache = new Map<number, any>();
  const resolve = (index: any): any => {
    if (typeof index !== 'number') return index;
    if (index < 0) return index === -1 ? undefined : index === -2 ? Number.NaN : index === -3 ? Infinity : index === -4 ? -Infinity : index === -5 ? -0 : null;
    if (cache.has(index)) return cache.get(index);
    const value = payload[index];
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string' && ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(value[0])) return resolve(value[1]);
      if (value[0] === 'Date') return resolve(value[1]);
      const result: any[] = [];
      cache.set(index, result);
      for (const item of value) result.push(resolve(item));
      return result;
    }
    const result: Record<string, any> = {};
    cache.set(index, result);
    for (const [key, item] of Object.entries(value)) result[key] = resolve(item);
    return result;
  };
  return resolve(0);
}

function globusCategory(item: any): string {
  const placements = Array.isArray(item?.productInHouse?.placements) ? item.productInHouse.placements : [];
  const haystack = [
    ...placements.flatMap((placement: any) => [placement?.department, placement?.category, placement?.subcategory]),
    ...(Array.isArray(item?.productCategories) ? item.productCategories : []),
    item?.name,
  ].filter(Boolean).join(' ').toLocaleLowerCase('cs');
  if (/alkohol|pivo|víno|vino|lihov|nápoj|napoj/.test(haystack)) return 'Nápoje';
  if (/droger|hygien|kosmet|prací|praci|čistic|cistic/.test(haystack)) return 'Drogerie';
  if (/zvíř|zvir|chovatel|krmiv|kočk|kock|pes|psi/.test(haystack)) return 'Chovatelské potřeby';
  if (/elektr|spotřebič|spotrebic/.test(haystack)) return 'Elektronika';
  if (/zahrad|gril|rostlin/.test(haystack)) return 'Zahrada';
  if (/textil|móda|moda|obleč|oblec|obuv/.test(haystack)) return 'Oblečení';
  if (/domác|domac|kuchyň|kuchyn|nábytek|nabytek/.test(haystack)) return 'Domácnost';
  return 'Potraviny';
}

function decodeHtml(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function htmlAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp("\\b" + name + "=[\"']([^\"']*)[\"']", "i"));
  return decodeHtml(match?.[1] || '').trim();
}

function imageMatchWords(value: string): string[] {
  const stop = new Set(['akce', 'ruzne', 'druhy', 'vybrane', 'baleni', 'cena', 'pouze', 'kus', 'kusu', 'jvp']);
  return [...new Set(String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|ks|%)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((word) => word.length > 2 && !stop.has(word)))];
}

function productImageScore(left: string, right: string): number {
  const a = imageMatchWords(left);
  const b = imageMatchWords(right);
  if (a.length < 2 || b.length < 2) return 0;
  const setB = new Set(b);
  const common = a.filter((word) => setB.has(word)).length;
  if (common < 2) return 0;
  const containment = common / Math.min(a.length, b.length);
  const precision = common / Math.max(a.length, b.length);
  return containment * 0.72 + precision * 0.28;
}

function findBillaImage(title: string): string | null {
  const normalized = normalizedImageTitle(title);
  const exact = BILLA_IMAGE_BY_TITLE.get(normalized);
  if (exact) return exact;

  let bestImage: string | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const [candidateTitle, image] of BILLA_IMAGE_BY_TITLE) {
    const score = productImageScore(normalized, candidateTitle);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestImage = image;
    } else if (score > secondScore) secondScore = score;
  }
  return bestImage && bestScore >= 0.86 && bestScore - secondScore >= 0.06 ? bestImage : null;
}

function findCatalogImage(title: string, catalog: Array<{ title: string; image: string }>): string | null {
  const normalized = normalizedImageTitle(title);
  const exact = catalog.find((candidate) => normalizedImageTitle(candidate.title) === normalized);
  if (exact) return exact.image;

  let best: { title: string; image: string } | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const candidate of catalog) {
    const score = productImageScore(title, candidate.title);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = candidate;
    } else if (score > secondScore) secondScore = score;
  }
  if (!best || bestScore < 0.9 || bestScore - secondScore < 0.08) return null;
  return best.image;
}

async function publishedImageCatalog(excludedStoreId: string): Promise<Array<{ title: string; image: string }>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from('offers')
    .select('title,image_url')
    .eq('status', 'published')
    .gte('valid_to', today)
    .neq('store_id', excludedStoreId)
    .not('image_url', 'is', null)
    .limit(3000);
  if (error) throw error;
  return (data || [])
    .filter((row: any) => /^https?:\/\//i.test(String(row.image_url || '')))
    .map((row: any) => ({ title: String(row.title || ''), image: String(row.image_url) }));
}

async function enrichFromPublishedCatalog(items: ExtractedItem[], storeId: string): Promise<ExtractedItem[]> {
  try {
    const catalog = await publishedImageCatalog(storeId);
    return items.map((item) => {
      if (item.image_url) return item;
      const image = findCatalogImage(item.title, catalog);
      return image ? { ...item, image_url: image } : item;
    });
  } catch (error) {
    console.warn('Published image catalog enrichment skipped:', error instanceof Error ? error.message : String(error));
    return items;
  }
}

async function backfillPublishedCatalogImages(storeId: string): Promise<{ updated: number; catalogMatches: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: offers, error: offersError }, catalog] = await Promise.all([
    db.from('offers').select('id,product_id,title,image_url').eq('store_id', storeId).eq('status', 'published').gte('valid_to', today).limit(1000),
    publishedImageCatalog(storeId),
  ]);
  if (offersError) throw offersError;
  const matches = (offers || [])
    .filter((offer: any) => !String(offer.image_url || '').trim())
    .map((offer: any) => {
      const image = findCatalogImage(String(offer.title || ''), catalog);
      return image ? { ...offer, image } : null;
    })
    .filter(Boolean) as Array<any>;

  let updated = 0;
  for (let offset = 0; offset < matches.length; offset += 8) {
    const batch = matches.slice(offset, offset + 8);
    await Promise.all(batch.map(async (match) => {
      const { error: offerError } = await db.from('offers').update({ image_url: match.image }).eq('id', match.id);
      if (offerError) throw offerError;
      if (match.product_id) {
        const { error: productError } = await db.from('products').update({ image_url: match.image }).eq('id', match.product_id);
        if (productError) throw productError;
      }
      updated++;
    }));
  }
  return { updated, catalogMatches: matches.length };
}

function tescoCatalogFromHtml(html: string): Array<{ title: string; image: string }> {
  const catalog: Array<{ title: string; image: string }> = [];
  for (const match of html.matchAll(/<li\b[^>]*data-testid=["'][^"']+["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const card = match[1];
    const titleMatch = card.match(/<h2\b[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const imageMatch = card.match(/<img\b[^>]*\bsrc=["'](https:\/\/digitalcontent\.api\.tesco\.com\/[^"']+)["']/i);
    const title = decodeHtml(String(titleMatch?.[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const image = decodeHtml(imageMatch?.[1] || '').replace(/[?&]w=\d+/i, '?w=500');
    if (title && image) catalog.push({ title, image });
  }
  return catalog;
}

async function findOfficialTescoImage(title: string): Promise<string | null> {
  try {
    const response = await fetch(`https://nakup.itesco.cz/shop/cs-CZ/search?query=${encodeURIComponent(title)}&inputType=free%20text`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SlevaoBot/1.0; +https://slevao.cz)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'cs-CZ,cs;q=0.9',
      },
    });
    if (!response.ok) return null;
    const catalog = tescoCatalogFromHtml(await response.text());
    if (!catalog.length) return null;
    const normalized = normalizedImageTitle(title);
    const exact = catalog.find((candidate) => normalizedImageTitle(candidate.title) === normalized);
    if (exact) return exact.image;

    let best: { title: string; image: string } | null = null;
    let bestScore = 0;
    let secondScore = 0;
    for (const candidate of catalog) {
      const score = productImageScore(title, candidate.title);
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = candidate;
      } else if (score > secondScore) secondScore = score;
    }
    const queryWords = imageMatchWords(title);
    const candidateWords = imageMatchWords(best?.title || '');
    const queryContained = queryWords.length >= 2 && queryWords.every((word) => candidateWords.includes(word));
    if (!best || bestScore < 0.74 || (!queryContained && bestScore - secondScore < 0.08)) return null;
    return best.image;
  } catch (error) {
    console.warn('Tesco official image lookup skipped:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function enrichAlbertImages(items: ExtractedItem[], storeId: string): Promise<ExtractedItem[]> {
  const enriched = await enrichFromPublishedCatalog(items, storeId);
  const missingIndexes = enriched.map((item, index) => item.image_url ? -1 : index).filter((index) => index >= 0);
  for (let offset = 0; offset < missingIndexes.length; offset += 6) {
    const batch = missingIndexes.slice(offset, offset + 6);
    const images = await Promise.all(batch.map((index) => findOfficialTescoImage(enriched[index].title)));
    images.forEach((image, position) => {
      if (image) enriched[batch[position]] = { ...enriched[batch[position]], image_url: image };
    });
  }
  return enriched;
}

async function backfillAlbertPublishedImages(storeId: string): Promise<{ updated: number; catalogMatches: number; officialMatches: number }> {
  const catalogResult = await backfillPublishedCatalogImages(storeId);
  const today = new Date().toISOString().slice(0, 10);
  const { data: offers, error } = await db.from('offers')
    .select('id,product_id,title,image_url')
    .eq('store_id', storeId)
    .eq('status', 'published')
    .gte('valid_to', today)
    .is('image_url', null)
    .limit(48);
  if (error) throw error;

  const matches: Array<any> = [];
  const missing = offers || [];
  for (let offset = 0; offset < missing.length; offset += 6) {
    const batch = missing.slice(offset, offset + 6);
    const images = await Promise.all(batch.map((offer: any) => findOfficialTescoImage(String(offer.title || ''))));
    images.forEach((image, position) => {
      if (image) matches.push({ ...batch[position], image });
    });
  }
  let officialMatches = 0;
  for (let offset = 0; offset < matches.length; offset += 8) {
    const batch = matches.slice(offset, offset + 8);
    await Promise.all(batch.map(async (match) => {
      const { error: offerError } = await db.from('offers').update({ image_url: match.image }).eq('id', match.id);
      if (offerError) throw offerError;
      if (match.product_id) {
        const { error: productError } = await db.from('products').update({ image_url: match.image }).eq('id', match.product_id);
        if (productError) throw productError;
      }
      officialMatches++;
    }));
  }
  return {
    updated: catalogResult.updated + officialMatches,
    catalogMatches: catalogResult.catalogMatches,
    officialMatches,
  };
}

function billaCatalogFromHtml(html: string): Array<{ title: string; image: string }> {
  const catalog: Array<{ title: string; image: string }> = [];
  for (const match of html.matchAll(/<li\b[^>]*data-teaser-name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const title = decodeHtml(match[1]).replace(/\s+/g, ' ').trim();
    const imageMatch = match[2].match(/https:\/\/images\.cdn\.europe-west1\.gcp\.commercetools\.com\/[^"' <]+/i);
    const image = decodeHtml(imageMatch?.[0] || '').replace(/&amp;/g, '&');
    if (title && image) catalog.push({ title, image });
  }
  for (const match of html.matchAll(/"([^"]{2,180})"[^"]{0,160}"(https:\\u002F\\u002Fimages\.cdn\.europe-west1\.gcp\.commercetools\.com[^"]+)"/gi)) {
    const title = decodeHtml(match[1]).replace(/\s+/g, ' ').trim();
    const image = match[2].replace(/\\u002F/gi, '/').replace(/\\u0026/gi, '&');
    if (title && image && !catalog.some((candidate) => candidate.title === title)) catalog.push({ title, image });
  }
  return catalog;
}

async function findOfficialBillaImage(title: string): Promise<string | null> {
  try {
    const response = await fetch(`https://www.billa.cz/vyhledavani/${encodeURIComponent(title)}?tab=products`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SlevaoBot/1.0; +https://slevao.cz)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'cs-CZ,cs;q=0.9',
      },
    });
    if (!response.ok) return null;
    const catalog = billaCatalogFromHtml(await response.text());
    if (!catalog.length) return null;
    const normalized = normalizedImageTitle(title);
    const exact = catalog.find((candidate) => {
      const candidateTitle = candidate.title.replace(/\s+•.*$/, '').trim();
      return normalizedImageTitle(candidateTitle) === normalized;
    });
    if (exact) return exact.image;

    let best: { title: string; image: string } | null = null;
    let bestScore = 0;
    let secondScore = 0;
    for (const candidate of catalog) {
      const score = productImageScore(title, candidate.title.replace(/\s+•.*$/, ''));
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = candidate;
      } else if (score > secondScore) secondScore = score;
    }
    return best && bestScore >= 0.88 && bestScore - secondScore >= 0.06 ? best.image : null;
  } catch (error) {
    console.warn('Billa official image lookup skipped:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function backfillBillaPublishedImages(storeId: string): Promise<{ updated: number; staticMatches: number; catalogMatches: number; officialMatches: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: billaOffers, error: billaError }, { data: imageOffers, error: imageError }] = await Promise.all([
    db.from('offers').select('id,product_id,title,image_url').eq('store_id', storeId).eq('status', 'published').gte('valid_to', today).limit(1000),
    db.from('offers').select('title,image_url').eq('status', 'published').gte('valid_to', today).not('image_url', 'is', null).limit(1000),
  ]);
  if (billaError) throw billaError;
  if (imageError) throw imageError;

  const catalog = (imageOffers || [])
    .filter((row: any) => /^https?:\/\//i.test(String(row.image_url || '')))
    .map((row: any) => ({ title: String(row.title || ''), image: String(row.image_url) }));
  const missingOffers = (billaOffers || []).filter((offer: any) => !String(offer.image_url || '').trim());
  const matches = missingOffers.map((offer: any) => {
    const staticImage = findBillaImage(String(offer.title || ''));
    const image = staticImage || findCatalogImage(String(offer.title || ''), catalog);
    return image ? { ...offer, image, source: staticImage ? 'static' : 'catalog' } : null;
  }).filter(Boolean) as Array<any>;
  const alreadyMatched = new Set(matches.map((match) => match.id));
  const unmatched = missingOffers.filter((offer: any) => !alreadyMatched.has(offer.id));
  for (let offset = 0; offset < unmatched.length; offset += 4) {
    const batch = unmatched.slice(offset, offset + 4);
    const officialMatches = await Promise.all(batch.map(async (offer: any) => {
      const image = await findOfficialBillaImage(String(offer.title || ''));
      return image ? { ...offer, image, source: 'official' } : null;
    }));
    matches.push(...officialMatches.filter(Boolean));
  }

  let updated = 0;
  for (let offset = 0; offset < matches.length; offset += 8) {
    const batch = matches.slice(offset, offset + 8);
    await Promise.all(batch.map(async (match) => {
      const { error: offerError } = await db.from('offers').update({ image_url: match.image }).eq('id', match.id);
      if (offerError) throw offerError;
      if (match.product_id) {
        const { error: productError } = await db.from('products').update({ image_url: match.image }).eq('id', match.product_id);
        if (productError) throw productError;
      }
      updated++;
    }));
  }
  return {
    updated,
    staticMatches: matches.filter((match) => match.source === 'static').length,
    catalogMatches: matches.filter((match) => match.source === 'catalog').length,
    officialMatches: matches.filter((match) => match.source === 'official').length,
  };
}

async function enrichKauflandImages(items: ExtractedItem[]): Promise<ExtractedItem[]> {
  try {
    const response = await fetch('https://prodejny.kaufland.cz/nabidka/prehled.html', {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SlevaoBot/1.0; +https://slevao.cz)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'cs-CZ,cs;q=0.9',
      },
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    const catalog: Array<{ title: string; image: string }> = [];
    for (const match of html.matchAll(/<img\b[^>]*class=["'][^"']*k-product-tile__main-image[^"']*["'][^>]*>/gi)) {
      const tag = match[0];
      const title = htmlAttribute(tag, 'alt').replace(/\s+/g, ' ').trim();
      const image = htmlAttribute(tag, 'src');
      if (title && /^https:\/\/kaufland\.media\.schwarz\/is\/image\//i.test(image)) catalog.push({ title, image });
    }
    if (!catalog.length) throw new Error('Oficiální stránka neobsahuje produktové fotografie.');

    return items.map((item) => {
      if (item.image_url) return item;
      let best: { title: string; image: string } | null = null;
      let bestScore = 0;
      let secondScore = 0;
      const query = [item.brand, item.title].filter(Boolean).join(' ');
      for (const candidate of catalog) {
        const score = productImageScore(query, candidate.title);
        if (score > bestScore) {
          secondScore = bestScore;
          bestScore = score;
          best = candidate;
        } else if (score > secondScore) secondScore = score;
      }
      const queryWords = imageMatchWords(query);
      const candidateWords = imageMatchWords(best?.title || '');
      const exactContainment = queryWords.length >= 2 && candidateWords.length >= 2
        && (queryWords.every((word) => candidateWords.includes(word)) || candidateWords.every((word) => queryWords.includes(word)));
      if (!best || bestScore < 0.78 || (!exactContainment && bestScore - secondScore < 0.08)) return item;
      return { ...item, image_url: best.image };
    });
  } catch (error) {
    console.warn('Kaufland image enrichment skipped:', error instanceof Error ? error.message : String(error));
    return items;
  }
}

function globusExtraction(html: string, metadata: any): ExtractionResult {
  const root = parseNuxtPayload(html);
  const data = root?.data || {};
  const listing = Object.entries(data).find(([key]) => key.startsWith('actionOfferProductListing-'))?.[1] as any;
  if (!listing || !Array.isArray(listing.products)) throw new Error('Globus nevrátil produkty aktuálního letáku.');

  const today = new Date().toISOString().slice(0, 10);
  const validFrom = String(metadata?.campaign_valid_from || '');
  const validTo = String(metadata?.campaign_valid_to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) {
    throw new Error('Globus import nemá spolehlivou platnost kampaně.');
  }

  const seen = new Set<string>();
  const items: ExtractedItem[] = [];
  for (const product of listing.products) {
    const house = product?.productInHouse || {};
    const itemFrom = String(house.priceValidFrom || '').slice(0, 10);
    const itemTo = String(house.priceValidTo || '').slice(0, 10);
    const price = Number(product?.calculatedPrice?.currentPrice ?? house.actualPrice);
    const normalPrice = Number(product?.calculatedPrice?.normalPrice ?? house.originalPrice);
    const title = String(product?.name || product?.billName || '').trim();
    const key = String(product?.vanr || title + '|' + price);
    if (!title || !(price > 0) || itemFrom > today || itemTo !== validTo || house.isActive === false || house.availability === 'N' || seen.has(key)) continue;
    seen.add(key);

    const rawBrand = product?.commonBrand?.name || product?.brand?.name || null;
    const brand = rawBrand && !/^normální$/i.test(String(rawBrand)) ? String(rawBrand) : null;
    const comparisonPrice = Number(house.comparisonPrice);
    items.push({
      title,
      brand,
      quantity_text: product?.sellUnitSizeText ? String(product.sellUnitSizeText) : null,
      price,
      old_price: normalPrice > price ? normalPrice : null,
      unit_price: comparisonPrice > 0 ? comparisonPrice : null,
      unit_label: house.comparisonSaleUnitSizeText ? String(house.comparisonSaleUnitSizeText) : null,
      image_url: product?.imgDetail ? String(product.imgDetail) : null,
      source_page: 1,
      confidence: 0.98,
      category_name: globusCategory(product),
    });
  }

  if (!items.length) throw new Error('Globus nevrátil žádné produkty z právě platného letáku.');
  return { valid_from: validFrom, valid_to: validTo, page_count: 1, items };
}

async function processImport(importId: string) {
  try {
    const { data: job, error: jobError } = await db.from('leaflet_imports')
      .select('*,leaflet_sources(auto_publish,name),stores(slug)').eq('id', importId).single();
    if (jobError || !job) throw jobError || new Error('Import nebyl nalezen.');
    if (['published', 'ignored'].includes(job.status)) return;

    await db.from('leaflet_imports').update({ status: 'downloading', started_at: new Date().toISOString(), error_message: null }).eq('id', importId);
    if (job.stores?.slug === 'billa') await backfillBillaPublishedImages(job.store_id);
    if (job.stores?.slug === 'albert') await backfillAlbertPublishedImages(job.store_id);
    const sourceResponse = await fetch(job.source_document_url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/pdf,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        referer: job.source_document_url.includes('tesco.com')
          ? 'https://www.itesco.cz/'
          : job.source_document_url.includes('gapi.globus.cz')
            ? 'https://www.globus.cz/'
            : new URL(job.source_document_url).origin + '/',
      },
      redirect: 'follow',
    });
    if (!sourceResponse.ok) throw new Error(`Stažení letáku selhalo: HTTP ${sourceResponse.status}`);

    let result: ExtractionResult;
    const isGlobusHtml = job.stores?.slug === 'globus' && job.metadata?.adapter === 'store:globus-html';
    if (isGlobusHtml) {
      const html = await sourceResponse.text();
      result = globusExtraction(html, job.metadata || {});
      await db.from('leaflet_imports').update({
        status: 'processing',
        metadata: {
          ...(job.metadata || {}),
          bytes: new TextEncoder().encode(html).length,
          detected_mime: 'text/html',
          structured_source: true,
          processing_started_at: new Date().toISOString(),
        },
      }).eq('id', importId);
    } else {
      const bytes = new Uint8Array(await sourceResponse.arrayBuffer());
      if (!bytes.length) throw new Error('Stažený leták je prázdný.');
      if (bytes.length > 50 * 1024 * 1024) throw new Error('Leták je větší než 50 MB.');

      const detected = detectDocumentType(sourceResponse.headers.get('content-type') || '', bytes);
      await ensureBucket();
      const storagePath = `${job.store_id || 'unknown'}/${importId}/source.${detected.extension}`;
      const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
        contentType: detected.mime,
        upsert: true,
      });
      if (uploadError) throw uploadError;

      await db.from('leaflet_imports').update({
        status: 'processing',
        metadata: {
          ...(job.metadata || {}),
          storage_bucket: STORAGE_BUCKET,
          storage_path: storagePath,
          bytes: bytes.length,
          detected_mime: detected.mime,
          ai_model: OPENAI_MODEL,
          processing_started_at: new Date().toISOString(),
        },
      }).eq('id', importId);

      result = await extractWithOpenAI(job.leaflet_sources?.name || '', detected.extension, detected.mime, bytes, importId);
    }
    const extractedItems = Array.isArray(result.items) ? result.items : [];
    const items = job.stores?.slug === 'kaufland' ? await enrichKauflandImages(extractedItems)
      : job.stores?.slug === 'billa' ? await enrichBillaImages(extractedItems)
        : job.stores?.slug === 'albert' ? await enrichAlbertImages(extractedItems, job.store_id)
        : extractedItems;
    if (!items.length) throw new Error(isGlobusHtml ? 'Globus nevrátil žádné produkty.' : 'AI v letáku nerozpoznala žádné produkty.');
    const isMakro = job.stores?.slug === 'makro';
    let detectedValidFrom = result.valid_from || '';
    let detectedValidTo = result.valid_to || '';
    const hasValidIsoRange = /^\d{4}-\d{2}-\d{2}$/.test(detectedValidFrom)
      && /^\d{4}-\d{2}-\d{2}$/.test(detectedValidTo)
      && detectedValidFrom <= detectedValidTo;
    if (isMakro && !hasValidIsoRange) {
      const start = new Date();
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      detectedValidFrom = start.toISOString().slice(0, 10);
      detectedValidTo = end.toISOString().slice(0, 10);
    }

    await db.from('leaflet_import_items').delete().eq('import_id', importId).neq('status', 'published');
    const categories = await categoryMap();
    const rows = items.filter((item) => item.title?.trim() && Number(item.price) > 0 && Number(item.price) <= 1_000_000 && Number(item.confidence ?? 0) >= 0.75).map((item) => {
      let price = Number(item.price);
      let oldPrice = item.old_price && Number(item.old_price) > price ? Number(item.old_price) : null;
      if (isMakro && oldPrice) {
        price = oldPrice;
        oldPrice = null;
      }
      return {
        import_id: importId,
        category_id: item.category_name ? categories.get(item.category_name.toLocaleLowerCase('cs')) || null : null,
        title: item.title.trim(),
        brand: item.brand || null,
        quantity_text: item.quantity_text || null,
        price,
        old_price: oldPrice,
        unit_price: item.unit_price ? Number(item.unit_price) : null,
        unit_label: item.unit_label || null,
        image_url: item.image_url || null,
        source_page: item.source_page || null,
        confidence: item.confidence ?? null,
        status: 'review',
        raw_data: { ...item, makro_vat_price_normalized: isMakro && Boolean(item.old_price) },
      };
    });

    if (!rows.length) throw new Error('AI nevrátila žádné nabídky s platnou cenou.');
    const { error: insertError } = await db.from('leaflet_import_items').insert(rows);
    if (insertError) throw insertError;

    const averageConfidence = rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length;
    const today = new Date().toISOString().slice(0, 10);
    const validFrom = detectedValidFrom;
    const validTo = detectedValidTo;
    const validDates = /^\d{4}-\d{2}-\d{2}$/.test(validFrom)
      && /^\d{4}-\d{2}-\d{2}$/.test(validTo)
      && validFrom <= validTo
      && validTo >= today
      && (Date.parse(validTo + 'T12:00:00Z') - Date.parse(validFrom + 'T12:00:00Z')) <= 62 * 86_400_000;
    const minimumAutoPublishConfidence = ['tesco', 'makro', 'billa'].includes(String(job.stores?.slug || '')) ? 0.88 : 0.92;
    const minimumAutoPublishProducts = job.stores?.slug === 'globus' ? 5 : 8;
    const autoPublish = Boolean(job.leaflet_sources?.auto_publish)
      && rows.length >= minimumAutoPublishProducts
      && averageConfidence >= minimumAutoPublishConfidence
      && validDates;
    await db.from('leaflet_imports').update({
      status: autoPublish ? 'publishing' : 'review',
      product_count: rows.length,
      confidence: averageConfidence || null,
      detected_valid_from: detectedValidFrom || null,
      detected_valid_to: detectedValidTo || null,
      page_count: result.page_count || null,
      error_message: null,
      finished_at: new Date().toISOString(),
    }).eq('id', importId);

    if (autoPublish) {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-imports`, {
        method: 'POST',
        headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ import_id: importId }),
      });
      if (!response.ok) throw new Error(`Publikace HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
    }
  } catch (error) {
    await markFailed(importId, error);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  const authorization = request.headers.get('authorization') || '';
  const body = await request.json().catch(() => ({}));
  const allowedByService = authorization === `Bearer ${SERVICE_ROLE_KEY}`;
  const allowedByCron = Boolean(CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET);
  let allowedByUser = false;
  if (!allowedByService && !allowedByCron && authorization.startsWith('Bearer ')) {
    const { data: userData } = await db.auth.getUser(authorization.slice(7).trim());
    const role = String(userData.user?.app_metadata?.role || userData.user?.user_metadata?.role || '').toLowerCase();
    allowedByUser = ['admin', 'editor'].includes(role);
  }
  if (!allowedByService && !allowedByCron && !allowedByUser) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });

  if (body.action === 'backfill-billa-images') {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'billa').single();
    if (storeError || !store) return Response.json({ error: storeError?.message || 'Obchod Billa nebyl nalezen.' }, { status: 404, headers: CORS_HEADERS });
    const result = await backfillBillaPublishedImages(store.id);
    return Response.json({ ok: true, ...result }, { headers: CORS_HEADERS });
  }

  if (body.action === 'backfill-albert-images') {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'albert').single();
    if (storeError || !store) return Response.json({ error: storeError?.message || 'Obchod Albert nebyl nalezen.' }, { status: 404, headers: CORS_HEADERS });
    const result = await backfillAlbertPublishedImages(store.id);
    return Response.json({ ok: true, ...result }, { headers: CORS_HEADERS });
  }

  const importId = String(body.import_id || '');
  if (!importId) return Response.json({ error: 'Missing import_id' }, { status: 400, headers: CORS_HEADERS });

  const { data: job, error } = await db.from('leaflet_imports').select('id,status').eq('id', importId).single();
  if (error || !job) return Response.json({ error: 'Import nebyl nalezen.' }, { status: 404, headers: CORS_HEADERS });
  if (['published', 'ignored'].includes(job.status)) return Response.json({ ok: true, skipped: true, status: job.status }, { headers: CORS_HEADERS });

  await db.from('leaflet_imports').update({ status: 'queued', error_message: null, finished_at: null }).eq('id', importId);
  runInBackground(processImport(importId));
  return Response.json({ ok: true, accepted: true, import_id: importId }, { status: 202, headers: CORS_HEADERS });
});
