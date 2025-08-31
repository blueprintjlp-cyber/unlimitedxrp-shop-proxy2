// netlify/edge-functions/proxy.js
const ORIGIN = new URL("https://unlimitedxrpshop.printify.me");

// Treat these as text we can safely rewrite
const TEXT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/javascript",
  "application/javascript",
  "application/json"
];

export default async (request, context) => {
  const reqUrl = new URL(request.url);

  // If their SPA tries to push to /page-not-found, always serve the homepage instead
  const upstreamPath =
    reqUrl.pathname.startsWith("/page-not-found") ? "/" : reqUrl.pathname;

  let upstreamUrl = new URL(upstreamPath + reqUrl.search, ORIGIN);

  const headers = new Headers(request.headers);
  // Forward as a real origin request
  headers.set("host", ORIGIN.host);
  headers.delete("connection");
  headers.set("x-forwarded-host", reqUrl.host);
  headers.set("x-forwarded-proto", reqUrl.protocol.replace(":", ""));

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body
  };

  let upstream = await fetch(upstreamUrl, init);

  // If ORIGIN sends a redirect, rewrite its Location to stay on our domain
  if (upstream.status >= 300 && upstream.status < 400) {
    const outHeaders = new Headers(upstream.headers);
    const loc = outHeaders.get("location") || "";
    if (loc) {
      try {
        const locUrl = new URL(loc, ORIGIN);
        // Normalize page-not-found to root
        if (locUrl.pathname.startsWith("/page-not-found")) locUrl.pathname = "/";
        // Rewrite origin to ours
        outHeaders.set(
          "location",
          new URL(locUrl.pathname + locUrl.search, reqUrl.origin).toString()
        );
      } catch (_) {
        // leave as-is if it's not a valid URL
      }
    }
    // Strip noisy server headers
    ["x-powered-by", "server", "via", "cf-ray", "cf-cache-status"].forEach(h => outHeaders.delete(h));
    return new Response(null, { status: upstream.status, headers: outHeaders });
  }

  const outHeaders = new Headers(upstream.headers);
  // Remove CSP that can block our tiny CSS inject and hostname rewrites
  outHeaders.delete("content-security-policy");
  // Remove other noisy headers
  ["x-powered-by", "server", "via", "cf-ray", "cf-cache-status"].forEach(h => outHeaders.delete(h));

  if (!outHeaders.has("cache-control")) {
    outHeaders.set("cache-control", "public, max-age=300");
  }

  const ct = outHeaders.get("content-type") || "";
  const isText = TEXT_TYPES.some(t => ct.includes(t));

  if (isText) {
    let body = await upstream.text();

    // Replace absolute origin references with our own domain
    const originRe = new RegExp(
      ORIGIN.origin.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"),
      "g"
    );
    body = body.replace(originRe, reqUrl.origin);

    // Also catch protocol-less or direct host references
    body = body.replace(/(https?:)?\/\/unlimitedxrpshop\.printify\.me/gi, reqUrl.origin);

    // Neutralize any SPA attempts to route to /page-not-found
    body = body.replace(/\/page-not-found/gi, "/");

    // Best-effort hide "Powered by Printify" badges/text
    body = body.replace(/Powered by\s*Printify/gi, "");
    const inject = `<style>[href*="printify.com"],.printify-badge,[data-testid="powered-by-printify"]{display:none!important;}</style>`;
    body = body.replace(/<head(.*?)>/i, `<head$1>${inject}`);

    const enc = new TextEncoder();
    outHeaders.set("content-length", String(enc.encode(body).length));
    return new Response(body, { status: upstream.status, headers: outHeaders });
  }

  // Stream non-text assets as-is
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
};

export const config = { path: "/*" };
