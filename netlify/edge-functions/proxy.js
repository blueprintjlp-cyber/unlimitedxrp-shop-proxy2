// netlify/edge-functions/proxy.js
const ORIGIN = new URL("https://unlimitedxrpshop.printify.me");

// Treat as text (we rewrite)
const TEXT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/javascript",
  "application/javascript",
  "application/json"
];

export default async (request, context) => {
  const reqUrl = new URL(request.url);

  // Any request to /page-not-found -> serve homepage instead
  const upstreamPath = reqUrl.pathname.startsWith("/page-not-found") ? "/" : reqUrl.pathname;
  const upstreamUrl = new URL(upstreamPath + reqUrl.search, ORIGIN);

  // Forward as if we are the origin
  const fwdHeaders = new Headers(request.headers);
  fwdHeaders.set("host", ORIGIN.host);
  fwdHeaders.delete("connection");
  fwdHeaders.set("x-forwarded-host", reqUrl.host);
  fwdHeaders.set("x-forwarded-proto", reqUrl.protocol.replace(":", ""));

  const init = {
    method: request.method,
    headers: fwdHeaders,
    redirect: "manual",
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body
  };

  let upstream = await fetch(upstreamUrl, init);

  // Rewrite server redirects to our domain, collapse /page-not-found -> /
  if (upstream.status >= 300 && upstream.status < 400) {
    const h = new Headers(upstream.headers);
    const loc = h.get("location") || "";
    if (loc) {
      try {
        const locUrl = new URL(loc, ORIGIN);
        if (locUrl.pathname.startsWith("/page-not-found")) locUrl.pathname = "/";
        h.set("location", new URL(locUrl.pathname + locUrl.search, reqUrl.origin).toString());
      } catch {}
    }
    strip(h);
    return new Response(null, { status: upstream.status, headers: h });
  }

  // If origin says 404, serve homepage instead
  if (upstream.status === 404) {
    upstream = await fetch(new URL("/", ORIGIN), init);
  }

  const out = new Headers(upstream.headers);
  out.delete("content-security-policy"); // avoid CSP blocking our tiny inject
  strip(out);
  if (!out.has("cache-control")) out.set("cache-control", "public, max-age=300");

  const ct = out.get("content-type") || "";
  const isText = TEXT_TYPES.some(t => ct.includes(t));

  if (!isText) {
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  // Text rewriting
  let body = await upstream.text();

  // Replace origin with our domain
  const originRe = new RegExp(ORIGIN.origin.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g");
  body = body.replace(originRe, reqUrl.origin);
  body = body.replace(/(https?:)?\/\/unlimitedxrpshop\.printify\.me/gi, reqUrl.origin);

  // Kill client-side pushes to /page-not-found (all variants)
  body = body
    .replace(/\/page-not-found/gi, "/")
    .replace(/location\.(assign|replace)\(['"]\/page-not-found['"]\)/gi, "location.$1('/')")
    .replace(/window\.location\s*=\s*['"]\/page-not-found['"]/gi, "window.location='/'")
  ;

  // Inject <base> so relative links resolve under our domain, and hide printify badges
  if (/<head[^>]*>/i.test(body)) {
    const inject = `<base href="/"><style>[href*="printify.com"],.printify-badge,[data-testid="powered-by-printify"]{display:none!important;}</style>`;
    body = body.replace(/<head(.*?)>/i, `<head$1>${inject}`);
  }

  // Let Netlify set content-length
  out.delete("content-length");
  return new Response(body, { status: upstream.status, headers: out });
};

function strip(h) {
  ["x-powered-by","server","via","cf-ray","cf-cache-status"].forEach(k => h.delete(k));
}

export const config = { path: "/*" };
