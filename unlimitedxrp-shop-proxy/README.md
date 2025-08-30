# Unlimited XRP Shop — Netlify Proxy to Printify

This repo deploys a clean proxy of your Printify storefront to your custom domain **unlimitedxrp.shop** using **Netlify Edge Functions**. It keeps customers on your domain and hides Printify branding.

## What you get
- 100% domain cloaking to `unlimitedxrp.shop` (no `printify.me` leaks)
- Link rewriting for HTML so all nav stays on your domain
- Basic removal of "Powered by Printify" text and badges (best-effort)
- Sensible security headers

## Files
- `netlify.toml` — routes all traffic to the Edge Function and sets headers.
- `netlify/edge-functions/proxy.ts` — the Deno/Edge proxy function.
- `README.md` — this guide.

## Setup (step-by-step)
1. **Create a new GitHub repo** (or use the one you already have) and add these files.
2. **Netlify → New Site from Git** → connect the repo. No build command is needed.
3. After deploy, go to **Site settings → Domains** and **add `unlimitedxrp.shop` and `www.unlimitedxrp.shop`**.
4. In **Namecheap DNS**:
   - Set `www` **CNAME** to your Netlify subdomain (shown by Netlify).
   - Set the apex/root `@` to the **A/ALIAS** target Netlify shows under your domain settings. (Use exactly what Netlify displays for **your** site.)
5. Back on Netlify Domains, click **Verify DNS** → **Provision certificate** (Let's Encrypt).
6. Visit `https://unlimitedxrp.shop` and verify pages load as your store (no `printify.me` in the address bar).

### Change your Printify origin (if needed)
Edit `netlify/edge-functions/proxy.ts` and update:
```ts
const ORIGIN = new URL("https://vaultfiber-xrp.printify.me");
```

### Common fixes
- **You see a Netlify 404**: most likely DNS not pointed yet or the Edge Function isn't deployed from this repo. Ensure this repo is the one Netlify is serving, then check Domain settings to confirm DNS & SSL are good.
- **Mixed content or broken assets**: hardcoded `printify.me` URLs should be auto-rewritten in HTML. If any assets come from scripts or JSON, open an issue with the URL so we can add a rewrite rule.
- **Branding still visible**: we remove text and hide common badges with CSS. Printify can change markup; update the selector list if needed.

## Local testing
Edge Functions run on Netlify’s edge, but you can use the Netlify CLI for a quick sanity check:
```bash
npm i -g netlify-cli
netlify dev
```
Then visit the local URL and it will run the function locally.

---

Built for a clean, premium **XRP Unlimited** experience.
