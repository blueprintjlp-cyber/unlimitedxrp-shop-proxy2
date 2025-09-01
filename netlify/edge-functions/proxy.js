// netlify/edge-functions/proxy.js
const ORIGIN = new URL("https://unlimitedxrpshop.printify.me");

const TEXT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/javascript",
  "application/javascript",
  "application/json"
];

export default async (request) => {
  const reqUrl = new URL(request.url);

  // Normalize any direct hit to /page-not-found to the homepage
  const upstreamPath = reqUrl.pathname.startsWith("/page-not-found") ? "/" : reqUrl.pathname;
  const upstreamUrl = new URL(upstreamPath + reqUrl.search, ORIGIN);

  // Forward like a real origin request
  const fwd = new Headers(request.headers);
  fwd.set("host", ORIGIN.host);
  fwd.delete("connection");
  fwd.set("x-forwarded-host", reqUrl.host);
  fwd.set("x-forwarded-proto", reqUrl.protocol.replace(":", ""));

  const init = {
    method: request.method,
    headers: fwd,
    redirect: "manual",
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body
  };

  let upstream = await fetch(upstreamUrl, init);

  // Rewrite server redirects and collapse /page-not-found -> /
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

  // If origin returns 404, serve homepage instead
  if (upstream.status === 404) {
    upstream = await fetch(new URL("/", ORIGIN), init);
  }

  const out = new Headers(upstream.headers);
  out.delete("content-security-policy"); // allow our small inject
  strip(out);
  if (!out.has("cache-control")) out.set("cache-control", "public, max-age=300");

  const ct = out.get("content-type") || "";
  const isText = TEXT_TYPES.some(t => ct.includes(t));

  if (!isText) {
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  // ---- Text rewriting & JS guard ----
  let body = await upstream.text();

  // Replace absolute & host-only origin refs with our domain
  const originRe = new RegExp(ORIGIN.origin.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g");
  body = body.replace(originRe, reqUrl.origin);
  body = body.replace(/(https?:)?\/\/unlimitedxrpshop\.printify\.me/gi, reqUrl.origin);

  // Guard against client-side pushes to /page-not-found (before their app runs)
  const guard = `
<script>(function(){
  function isNF(u){try{if(typeof u==='string'){return u.indexOf('/page-not-found')>-1;} if(u&&u.pathname){return u.pathname.indexOf('/page-not-found')===0;} }catch(e){} return false;}
  var la = location.assign.bind(location);
  location.assign = function(u){ if(isNF(u)) return; return la(u); };
  var lr = location.replace.bind(location);
  location.replace = function(u){ if(isNF(u)) return; return lr(u); };
  var ps = history.pushState.bind(history);
  history.pushState = function(s,t,u){ if(isNF(u)) u='/'; return ps(s,t,u); };
  var rs = history.replaceState.bind(history);
  history.replaceState = function(s,t,u){ if(isNF(u)) u='/'; return rs(s,t,u); };
})();</script>`.trim();

  // Inject <base>, CSS (hide printify badges), and the guard script as early as possible
  if (/<head[^>]*>/i.test(body)) {
    const inject = `<base href="/"><style>[href*="printify.com"],.printify-badge,[data-testid="powered-by-printify"]{display:none!important;}</style>${guard}`;
    body = body.replace(/<head(.*?)>/i, `<head$1>${inject}`);
  } else {
    // Fallback injection if <head> missing
    body = `${guard}${body}`;
  }

  // Normalize literal references to /page-not-found in text assets
  body = body.replace(/\/page-not-found/gi, "/");

  // Let Netlify set content-length
  out.delete("content-length");
  return new Response(body, { status: upstream.status, headers: out });
};

function strip(h) {
  ["x-powered-by","server","via","cf-ray","cf-cache-status"].forEach(k => h.delete(k));
}

export const config = { path: "/*" };
