// netlify/edge-functions/proxy.js
const ORIGIN = new URL("https://unlimitedxrpshop.printify.me");

export default async (request) => {
  const reqUrl = new URL(request.url);

  // Normalize direct hits to /page-not-found -> /
  const path = reqUrl.pathname.startsWith("/page-not-found") ? "/" : reqUrl.pathname;
  const upstreamUrl = new URL(path + reqUrl.search, ORIGIN);

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

  // Rewrite server redirects
  if (upstream.status >= 300 && upstream.status < 400) {
    const h = new Headers(upstream.headers);
    const loc = h.get("location") || "";
    if (loc) {
      try {
        const u = new URL(loc, ORIGIN);
        if (u.pathname.startsWith("/page-not-found")) u.pathname = "/";
        h.set("location", new URL(u.pathname + u.search, reqUrl.origin).toString());
      } catch {}
    }
    stripNoise(h);
    h.set("cache-control", "no-store");
    return new Response(null, { status: upstream.status, headers: h });
  }

  // Origin 404 -> serve homepage
  if (upstream.status === 404) {
    upstream = await fetch(new URL("/", ORIGIN), init);
  }

  const out = new Headers(upstream.headers);
  const ct = (out.get("content-type") || "").toLowerCase();
  const isHTML = ct.includes("text/html");

  // relax CSP and noise
  out.delete("content-security-policy");
  stripNoise(out);
  out.set("cache-control", "no-store");

  if (!isHTML) {
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  // ---- HTML rewrite (light, no base tag, no global replaces) ----
  let html = await upstream.text();

  // Replace absolute & host-only origin refs with our domain
  const originRe = new RegExp(ORIGIN.origin.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g");
  html = html.replace(originRe, reqUrl.origin)
             .replace(/(https?:)?\/\/unlimitedxrpshop\.printify\.me/gi, reqUrl.origin);

  // Inject a once-only guard to ignore pushes to /page-not-found (no reload loops)
  const guard = `
<script>(function(){
  if (window.__xrpGuard) return; window.__xrpGuard = true;
  function isNF(u){try{if(typeof u==='string'){return u.indexOf('/page-not-found')>-1;}
    if(u&&u.pathname){return u.pathname.indexOf('/page-not-found')===0;}}catch(e){} return false;}
  var la = location.assign.bind(location);
  location.assign = function(u){ if(isNF(u)) return; return la(u); };
  var lr = location.replace.bind(location);
  location.replace = function(u){ if(isNF(u)) return; return lr(u); };
  var ps = history.pushState.bind(history);
  history.pushState = function(s,t,u){ if(u && isNF(u)) u='/'; return ps(s,t,u); };
  var rs = history.replaceState.bind(history);
  history.replaceState = function(s,t,u){ if(u && isNF(u)) u='/'; return rs(s,t,u); };
})();</script>`.trim();

  // Put guard just before </head> if possible, else at start of body
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${guard}</head>`);
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>${guard}`);
  } else {
    html = guard + html;
  }

  // Do NOT set content-length (avoid reload from size mismatch)
  out.delete("content-length");
  return new Response(html, { status: upstream.status, headers: out });
};

function stripNoise(h) {
  ["x-powered-by","server","via","cf-ray","cf-cache-status"].forEach(k => h.delete(k));
}

export const config = { path: "/*" };
