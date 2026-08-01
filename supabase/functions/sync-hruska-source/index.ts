import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://mojehruska.cz/';
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
  'cache-control': 'no-cache',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function isAllowed(request: Request): Promise<boolean> {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  return ['admin', 'editor'].includes(role);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function absoluteUrl(base: string, href: string): string | null {
  try {
    return new URL(href.replace(/&amp;/g, '&').replace(/\\\//g, '/'), base).toString();
  } catch {
    return null;
  }
}

function findCurrentPdf(html: string, pageUrl: string): string {
  const candidates = new Set<string>();
  const patterns = [
    /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi,
    /https?:\/\/[^\s"'<>\\]+\.pdf(?:\?[^\s"'<>\\]*)?/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const url = absoluteUrl(pageUrl, match[1] || match[0]);
      if (url && /(?:media\.)?mojehruska\.cz/i.test(url)) candidates.add(url);
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    const aScore = /\/20\d{2}\/\d{1,2}\//.test(a) ? 10 : 0;
    const bScore = /\/20\d{2}\/\d{1,2}\//.test(b) ? 10 : 0;
    return bScore - aScore;
  });

  if (!sorted.length) throw new Error('Oficiální stránka Hrušky neobsahuje odkaz na aktuální PDF leták.');
  return sorted[0];
}

async function queueProcessor(importId: string): Promise<void> {
  const response = await fetch(PROCESSOR_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(CRON_SECRET ? { 'x-cron-secret': CRON_SECRET } : {}),
    },
    body: JSON.stringify({ import_id: importId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Zpracování Hrušky selhalo: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!(await isAllowed(request))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  const checkedAt = new Date().toISOString();

  try {
    const { data: store, error: storeError } = await db
      .from('stores')
      .select('id,name,slug')
      .eq('slug', 'hruska')
      .maybeSingle();

    if (storeError) throw storeError;
    if (!store) {
      return Response.json({
        ok: false,
        skipped: true,
        reason: 'V tabulce stores zatím chybí obchod se slugem hruska.',
      }, { headers: CORS_HEADERS });
    }

    const { data: existingSource, error: sourceError } = await db
      .from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (sourceError) throw sourceError;

    const sourcePayload = {
      name: 'Hruška – aktuální leták',
      source_url: SOURCE_URL,
      source_type: 'html',
      is_active: true,
      auto_publish: true,
      check_interval_minutes: 360,
      coverage_scope: 'national',
      last_error: null,
    };

    let sourceId: string;
    if (existingSource) {
      const { error } = await db.from('leaflet_sources').update(sourcePayload).eq('id', existingSource.id);
      if (error) throw error;
      sourceId = existingSource.id;
    } else {
      const { data: created, error } = await db.from('leaflet_sources').insert({
        store_id: store.id,
        ...sourcePayload,
      }).select('id').single();
      if (error) throw error;
      sourceId = created.id;
    }

    const pageResponse = await fetch(SOURCE_URL, {
      headers: { ...BROWSER_HEADERS, referer: SOURCE_URL },
      redirect: 'follow',
    });
    if (!pageResponse.ok) throw new Error(`Oficiální web Hrušky vrátil HTTP ${pageResponse.status}.`);

    const html = await pageResponse.text();
    const pdfUrl = findCurrentPdf(html, pageResponse.url || SOURCE_URL);

    const pdfHead = await fetch(pdfUrl, {
      method: 'HEAD',
      headers: { ...BROWSER_HEADERS, referer: SOURCE_URL },
      redirect: 'follow',
    }).catch(() => null);
    if (pdfHead && !pdfHead.ok) throw new Error(`PDF leták Hrušky vrátil HTTP ${pdfHead.status}.`);

    const sourceHash = await sha256(`${sourceId}|${pdfUrl}|hruska-pdf-v1`);
    const { data: existingImport, error: existingImportError } = await db
      .from('leaflet_imports')
      .select('id,status,updated_at')
      .eq('source_hash', sourceHash)
      .maybeSingle();

    if (existingImportError) throw existingImportError;

    let importId = existingImport?.id || null;
    let createdImport = false;

    if (!existingImport) {
      const { data: createdImportRow, error: importError } = await db.from('leaflet_imports').insert({
        source_id: sourceId,
        store_id: store.id,
        source_document_url: pdfUrl,
        source_hash: sourceHash,
        status: 'queued',
        coverage_scope: 'national',
        metadata: {
          discovered_at: checkedAt,
          source_name: 'Hruška – aktuální leták',
          adapter: 'store:hruska-pdf',
          candidate_filter: 'official-current-pdf-v1',
        },
      }).select('id').single();

      if (importError) throw importError;
      importId = createdImportRow.id;
      createdImport = true;
      await queueProcessor(importId);
    } else {
      const ageMs = Date.now() - new Date(existingImport.updated_at || 0).getTime();
      const retryable = existingImport.status === 'failed' && ageMs >= 60 * 60_000;
      const stale = ['queued', 'downloading', 'processing'].includes(String(existingImport.status || '')) && ageMs >= 10 * 60_000;

      if (retryable || stale) {
        const archivedHash = `${sourceHash}:archived:${existingImport.id}:${Date.now()}`;
        const { error: archiveError } = await db.from('leaflet_imports').update({
          source_hash: archivedHash,
          status: 'failed',
          error_message: stale ? 'Předchozí zpracování Hrušky překročilo časový limit.' : undefined,
          finished_at: stale ? checkedAt : undefined,
        }).eq('id', existingImport.id);
        if (archiveError) throw archiveError;

        const { data: retryImport, error: retryError } = await db.from('leaflet_imports').insert({
          source_id: sourceId,
          store_id: store.id,
          source_document_url: pdfUrl,
          source_hash: sourceHash,
          status: 'queued',
          coverage_scope: 'national',
          metadata: {
            discovered_at: checkedAt,
            source_name: 'Hruška – aktuální leták',
            adapter: 'store:hruska-pdf',
            candidate_filter: 'official-current-pdf-v1',
            retry_of: existingImport.id,
          },
        }).select('id').single();
        if (retryError) throw retryError;
        importId = retryImport.id;
        createdImport = true;
        await queueProcessor(importId);
      }
    }

    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
    }).eq('id', sourceId);

    return Response.json({
      ok: true,
      store: store.name,
      source_id: sourceId,
      pdf_url: pdfUrl,
      import_id: importId,
      import_created: createdImport,
      import_status: existingImport?.status || (createdImport ? 'queued' : null),
      adapter: 'store:hruska-pdf',
    }, { headers: CORS_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const { data: store } = await db.from('stores').select('id').eq('slug', 'hruska').maybeSingle();
      if (store?.id) {
        await db.from('leaflet_sources').update({
          last_checked_at: checkedAt,
          last_error: message,
        }).eq('store_id', store.id);
      }
    } catch {
      // Zachovej původní chybu.
    }
    return Response.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
});
