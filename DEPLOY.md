# Deploy Stranded on Render

Wallet is a static Vite app. The Arb Sepolia Relayer is a Node service that must stay up to quote and broadcast. Neither stores a private key in git.

## 1. Push this repo

Render deploys from GitHub (`SAW72/gas-rescue`). Push the branch that has `render.yaml`, `wallet/`, and `relayer/`.

## 2. Create the Blueprint

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect `SAW72/gas-rescue`
3. Apply `render.yaml`

That creates:

| Service | Type | Default URL |
|---|---|---|
| `stranded` | Static site | `https://stranded.onrender.com` |
| `stranded-relayer-arb` | Web | `https://stranded-relayer-arb.onrender.com` |

## 3. Secrets (dashboard only)

On **stranded-relayer-arb**:

- `RELAYER_PRIVATE_KEY` — same Arb relayer key you already use locally. Paste it in Render. Never commit it.
- `CORS_ORIGINS` — comma-separated, no trailing slash:

```
https://stranded.onrender.com,http://localhost:5173,http://127.0.0.1:5173
```

When your custom domain is live, add it:

```
https://stranded.onrender.com,https://YOUR.DOMAIN,http://localhost:5173
```

Then **restart** the Relayer (CORS is read at boot).

On **stranded** (static site):

- `VITE_RELAYER_URL_ARB_SEPOLIA` is filled from the Relayer URL at **build** time.
- If you change the Relayer URL later, **rebuild** the static site.

Optional Base Sepolia live quotes: set `VITE_RELAYER_URL` to your existing Base Relayer origin and rebuild.

## 4. Custom domain

1. Buy the domain (Namecheap, Cloudflare, Google Domains, etc.).
2. Render → **stranded** static site → **Custom Domains** → add `YOUR.DOMAIN` and `www.YOUR.DOMAIN` if you want both.
3. At the registrar, add the CNAME (or A/ALIAS) Render shows. Prefer Cloudflare DNS **proxied** (orange cloud) only if you follow Render’s Cloudflare notes; otherwise DNS-only.
4. Wait for HTTPS to show **Issued**.
5. Add `https://YOUR.DOMAIN` to Relayer `CORS_ORIGINS` and restart the Relayer.
6. Optional: add `api.YOUR.DOMAIN` as a custom domain on **stranded-relayer-arb**, set `VITE_RELAYER_URL_ARB_SEPOLIA=https://api.YOUR.DOMAIN`, rebuild the static site.

MetaMask will show the HTTPS origin on permit/order prompts. `http://` on a public domain will fail.

## 5. Check it

```
curl -sS https://stranded-relayer-arb.onrender.com/health
```

Expect `ok: true`, `chainId: 421614`, `swap: 0x65e7…`. Then open the static URL, pick **Arb Sepolia**, connect, quote, sign.

## Do not

- Put `RELAYER_PRIVATE_KEY` or owner keys in `render.yaml` or git
- Point Arb `VITE_RELAYER_URL_ARB_SEPOLIA` at the Base Relayer
- Change the proven swap / token / router addresses
