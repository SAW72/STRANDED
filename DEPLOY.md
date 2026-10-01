# Deploy Stranded on Render

Wallet is a static Vite app. The Arb Sepolia Relayer is a Node service that must stay up to quote and broadcast. Neither stores a private key in git.

## 1. Repo and host

The GitHub repo is `SAW72/STRANDED`.

The wallet host is a Render static site named `stranded`, built from `render.yaml`. Render auto-deploys that site on commits to `main`.

| | URL |
|---|---|
| Live wallet | https://strandedtoken.trade |
| Render default URL | https://gas-rescue.onrender.com |

`www.strandedtoken.trade` redirects to the apex `https://strandedtoken.trade`.

The Arb Sepolia Relayer is the web service `stranded-relayer-arb` at https://stranded-relayer-arb.onrender.com.

## 2. Blueprint

`render.yaml` defines the static site and the Relayer. In the [Render Dashboard](https://dashboard.render.com), a Blueprint connected to `SAW72/STRANDED` applies that file.

| Service | Type | URL |
|---|---|---|
| `stranded` | Static site | https://gas-rescue.onrender.com |
| `stranded-relayer-arb` | Web | https://stranded-relayer-arb.onrender.com |

The live custom domain on `stranded` is https://strandedtoken.trade.

## 3. Secrets (dashboard only)

On **stranded-relayer-arb**:

- `RELAYER_PRIVATE_KEY` — 32-byte hex private key of the allowlisted relayer (`0x8240…9AF6`). Include `0x` or not; the server normalizes it. Never paste the address. Never commit it.
- `CORS_ORIGINS` — comma-separated, no trailing slash. Include the live wallet and the Render default URL:

```
https://strandedtoken.trade,https://gas-rescue.onrender.com,http://localhost:5173,http://127.0.0.1:5173
```

If you add another public origin, append it here. Then **restart** the Relayer (CORS is read at boot).

Optional control-plane vars on **stranded-relayer-arb** (see `relayer/.env.example`):

- `KILL_SWITCH` — `1`/`true` refuses new quotes and rescues. `/health` stays HTTP 200 with `paused: true` so Render does not recycle the service.
- `ADMIN_SECRET` — if set, `POST /v1/admin/pause` and `/v1/admin/unpause` with header `x-admin-secret` (or `Authorization: Bearer`). Leave unset to 404 those routes. Never commit the secret.
- `DATA_DIR` — append-only `rescues.jsonl` (quote id, order summary, txHash or error). No private keys or permit/order signatures. Render disk is ephemeral unless you attach one.
- `BROADCAST_MAX_ATTEMPTS` / `BROADCAST_RETRY_BASE_MS` — bounded retry after simulate-ok for transient RPC / account-nonce / replacement only.

Contract `pause()` remains owner-only and is unchanged. `FEE_TO` is unchanged.

On **stranded** (static site):

- `VITE_RELAYER_URL_ARB_SEPOLIA` is filled from the Relayer URL at **build** time.
- If you change the Relayer URL later, **rebuild** the static site.

Optional Base Sepolia live quotes: set `VITE_RELAYER_URL` to your existing Base Relayer origin and rebuild.

## 4. Custom domain

The static site `stranded` serves the live wallet at https://strandedtoken.trade. `www.strandedtoken.trade` redirects to that apex. Render's default URL https://gas-rescue.onrender.com stays available.

To attach another domain: Render → **stranded** → **Custom Domains**, add the DNS record Render shows, and wait until HTTPS is **Issued**. Add `https://` that host to Relayer `CORS_ORIGINS` and restart the Relayer.

MetaMask shows the HTTPS origin on permit/order prompts. `http://` on a public domain will fail.

## 5. Check it

```
curl -sS https://stranded-relayer-arb.onrender.com/health
```

Expect `ok: true`, `chainId: 421614`, `swap: 0x65e7…`. Then open https://strandedtoken.trade or https://gas-rescue.onrender.com, pick **Arb Sepolia**, connect, quote, sign.

## Do not

- Put `RELAYER_PRIVATE_KEY` or owner keys in `render.yaml` or git
- Point Arb `VITE_RELAYER_URL_ARB_SEPOLIA` at the Base Relayer
- Change the proven swap / token / router addresses
