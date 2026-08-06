const VIEWER_URL = 'https://katalogy.bauhaus.cz/katalog-srpen/';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'application/pdf,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
  referer: VIEWER_URL,
  origin: 'https://katalogy.bauhaus.cz',
};
Deno.serve(async () => {
  const response = await fetch(new URL('GetPDF.ashx', VIEWER_URL), {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pageNumbers: '' }).toString(),
    redirect: 'manual',
  });
  let firstBytes: number[] = [];
  if (response.body) {
    const reader = response.body.getReader();
    const first = await reader.read();
    firstBytes = first.value ? [...first.value.slice(0, 16)] : [];
    await reader.cancel();
  }
  return Response.json({
    status: response.status,
    location: response.headers.get('location'),
    content_type: response.headers.get('content-type'),
    content_length: response.headers.get('content-length'),
    content_disposition: response.headers.get('content-disposition'),
    first_bytes: firstBytes,
    first_text: firstBytes.map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join(''),
  });
});
