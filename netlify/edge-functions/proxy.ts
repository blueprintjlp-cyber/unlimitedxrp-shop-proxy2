// netlify/edge-functions/proxy.ts
// Deno/Edge Function to proxy Printify storefront under your own domain
// Origin storefront (Printify) is set below in ORIGIN.
// If you change your Printify subdomain, update ORIGIN.

const ORIGIN = new URL("https://vaultfiber-xrp.printify.me");

const textLike = new Set([
  "text/html",
  "application/xhtml+xml"
]);

export default async (request: Request, context: any) => {
  const reqUrl = new URL(request.url);

  // Build the upstream URL (keep path & query as-is)
  const upstreamUrl = new URL(reqUrl.pathname + reqUrl.search, ORIGIN);

  // Forward method, headers, and body where appropriate
  const init: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    redirect: "manual"
  };

  // Clean hop-by-hop headers and host header
  init.headers.delete("host");
  init.headers.delete("connection");
  init.headers.set("x-forwarded-host", reqUrl.host);
  init.headers.set("x-forwarded-proto", reqUrl.protocol.replace(":", ""));

  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
  }

  const upstream = await fetch(upstreamUrl, init);

  // Clone headers and strip identifying ones
  const headers = new Headers(upstream.headers);
  const status = upstream.status;

  // Remove or sanitize headers that might leak the origin
  ["x-powered-by", "server", "via", "cf-ray", "cf-cache-status"].forEach(h => headers.delete(h));

  // Always set our own caching policy conservatively
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "public, max-age=300");
  }

  const contentType = headers.get("content-type") || "";

  // If HTML, rewrite absolute links and optionally hide "Powered by Printify"
  if ([...textLike].some(t => contentType.includes(t))) {
    let html = await upstream.text();

    // Replace absolute origin references with our own domain
    const originRegex = new RegExp(ORIGIN.origin.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g");
    html = html.replace(originRegex, reqUrl.origin);

    // Also catch protocol-less or host-only references
    html = html.replace(/(https?:)?\/\/vaultfiber-xrp\.printify\.me/gi, reqUrl.origin);

    // Optional: remove "Powered by Printify" footer text (best-effort)
    html = html.replace(/Powered by\s*Printify/gi, ""); // remove text
    // Inject tiny CSS to hide common footer badges if present
    const inject = `<style> [href*="printify.com"], .printify-badge, [data-testid="powered-by-printify"]{display:none !important;} </style>`;
    html = html.replace(/<head(.*?)>/i, `<head$1>${inject}`);

    headers.set("content-length", String(new TextEncoder().encode(html).length));
    return new Response(html, { status, headers });
  }

  // For non-HTML assets, stream through as-is
  return new Response(upstream.body, {
    status,
    headers
  });
};

export const config = { path: "/*" };
