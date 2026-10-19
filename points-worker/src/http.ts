const ALLOWED_ORIGIN = "https://strandedtoken.trade";

export function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type, x-points-signature, x-points-timestamp");
  headers.set("access-control-max-age", "86400");
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("access-control-allow-origin", ALLOWED_ORIGIN);
  }
  return headers;
}

export function json(request: Request, status: number, body: unknown): Response {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export function empty(request: Request, status: number): Response {
  return new Response(null, { status, headers: corsHeaders(request) });
}
