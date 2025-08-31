// netlify/edge-functions/proxy.js
const ORIGIN = new URL("https://unlimitedxrpshop.printify.me");

export default async (request, context) => {
  const reqUrl = new URL(request.url);
  const upstreamUrl = new URL(reqUrl.pathname + reqUrl.search, ORIGIN);

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.set("x-forwarded-host", reqUrl.host);
  headers.set("x-forwarded-proto", reqUrl.protocol.replace(":", ""));

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body
  };

  const upstream = await fetch(upstreamUrl, init);
  const resHeaders = new Headers(upstream.headers);
  ["x-powered-by", "server", "via", "cf-ray", "cf-cache-status"].forEach(h => resHeaders.delete(h));
  if (!resHeaders.has("cache-control")) resHeaders.set("cache-control", "public, max-age=300");

  const ct = resHeaders.get("content-type") || "";
  const isHTML = ct.includes("text/html") || ct.includes("application/xhtml+xml");

  if (isHTML) {
    let html = await upstream.text();

    // replace all absolute references to the Printify origin with your domain
    const originRe = new RegExp(ORIGIN.origin.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g");
    html = html.replace(originRe, reqUrl.origin);

    // catch protocol-less or other host references to your Printify subdomain
    html = html.replace(/(https?:)?\/\/unlimitedxrpshop\.printify\.me/gi, reqUrl.origin);

    // hide "Powered by Printify" (best-effort)
    html = html.replace(/Powered by\s*Printify/gi, "");
    const inject = `<style>[href*="printify.com"],.printify-badge,[data-testid="powered-by-printify"]{display:none!important;}</style>`;
    html = html.replace(/<head(.*?)>/i, `<head$1>${inject}`);

    const encoder = new TextEncoder();
    resHeaders.set("content-length", String(encoder.encode(html).length));
    return new Response(html, { status: upstream.status, headers: resHeaders });
  }

  // stream non-HTML assets as-is
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
};

export const config = { path: "/*" };
