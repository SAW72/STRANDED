# Deploy Stranded on Render

Wallet is a static Vite app. The Arb Sepolia Relayer is a Node service that must stay up to quote and broadcast. Neither stores a private key in git.

## 1. Repo and host

The GitHub repo is `SAW72/STRANDED`.

The wallet host is a Render static site named `stranded`, built from `render.yaml`. Render auto-deploys that site on commits to `main`.

Use the wallet at https://strandedtoken.trade. `www.strandedtoken.trade` redirects to that apex.

https://gas-rescue.onrender.com is only the Render origin host for the static site. The live relayer's CORS allowlist is `https://strandedtoken.trade`, `http://localhost:5173`, and `http://127.0.0.1:5173` (the last two are for local Vite dev). A page opened on `gas-rescue.onrender.com` gets no `Access-Control-Allow-Origin` and rescue requests from it are blocked.

The Arb Sepolia Relayer is the web service `stranded-relayer-arb` at https://stranded-relayer-arb.onrender.com.

## 2. Blueprint

`render.yaml` defines the static site and the Relayer. In the [Render Dashboard](https://dashboard.render.com), a Blueprint connected to `SAW72/STRANDED` applies that file.

| Service | Type | URL |
|---|---|---|
| `stranded` | Static site | https://gas-rescue.onrender.com |
| `stranded-relayer-arb` | Web | https://stranded-relayer-arb.onrender.com |

The wallet must be used at https://strandedtoken.trade. https://gas-rescue.onrender.com is the Render origin host only.

### Response headers

`render.yaml` declares these headers for the static site `stranded` on `path: /*`. A git push does not apply them. Render static sites do not read a Netlify-style `_headers` file ([Static site headers](https://render.com/docs/static-site-headers), [Blueprint spec `headers`](https://render.com/docs/blueprint-spec)). The rules below are applied only when someone syncs the Blueprint, or sets the same rules on the static site under **Settings → Headers**.

| Header | Declared value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

`Content-Security-Policy` in that file is only `frame-ancestors 'none'`. It does not set `default-src` or any other directive.

Checked with HEAD on 2026-10-27. `strandedtoken.trade` is Cloudflare in front of `gas-rescue.onrender.com`. None of the clickjacking headers or the referrer header are on the wire. HSTS is live only on the Render origin, and that value is Render's default for `*.onrender.com`, not the blueprint value.

| URL | Status | Security headers on that response |
|---|---|---|
| `https://strandedtoken.trade/` (also `/points` and `/points/`) | 200 | `X-Content-Type-Options: nosniff` only. No `Strict-Transport-Security`, no `Content-Security-Policy`, no `X-Frame-Options`, no `Referrer-Policy`. |
| `https://www.strandedtoken.trade/` | 301 to the apex | None of those headers. The redirect itself does not send `nosniff`. |
| `https://gas-rescue.onrender.com/` | 200 | `Strict-Transport-Security: max-age=315360000; includeSubdomains; preload` and `X-Content-Type-Options: nosniff`. No `Content-Security-Policy`, no `X-Frame-Options`, no `Referrer-Policy`. |

Applying the declared response headers takes one of these. This repository change does none of them.

1. Spencer syncs the Render Blueprint for `SAW72/STRANDED`, so the `headers` field is applied. Render matches those paths on every custom domain attached to the site. A git auto-deploy does not sync the Blueprint. Confirm with the curl below after the sync.
2. Spencer adds the same rules in the Render Dashboard: **stranded → Settings → Headers**.
3. A Cloudflare response-header Transform Rule on `strandedtoken.trade` and `www.strandedtoken.trade`. HSTS for the public hostname belongs here. Cloudflare fronts that name and currently sends no HSTS on it. The Render-default HSTS exists only on `gas-rescue.onrender.com`.

`frame-ancestors`, `X-Frame-Options`, and `Strict-Transport-Security` cannot be set from HTML. Browsers ignore them in `<meta>`.

The wallet shell does set the document referrer policy, which a meta tag can set:

```html
<meta name="referrer" content="strict-origin-when-cross-origin" />
```

That tag is in `wallet/index.html`. The build copies the shell to `wallet/dist/points/index.html`, so `/` and `/points` both get it. It applies after the browser parses the HTML. It is not a `Referrer-Policy` response header, and it does not cover the `www` redirect.

Check the response headers:

```
curl -sSI https://strandedtoken.trade/ https://www.strandedtoken.trade/ https://gas-rescue.onrender.com/
```

Until one of the three steps above, expect `strict-transport-security` only on `gas-rescue.onrender.com`, with `max-age=315360000; includeSubdomains; preload`. Expect no `content-security-policy`, `x-frame-options`, or `referrer-policy` on any of the three. After this wallet change is on `main`, the document policy is in the HTML:

```
curl -sS https://strandedtoken.trade/ https://strandedtoken.trade/points/ | grep -F 'name="referrer"'
```

Expect one match per URL, each with `content="strict-origin-when-cross-origin"`.

## 3. Secrets (dashboard only)

On **stranded-relayer-arb**:

- `RELAYER_PRIVATE_KEY` — 32-byte hex private key of the allowlisted relayer (`0x8240…9AF6`). Include `0x` or not; the server normalizes it. Never paste the address. Never commit it.
- `CORS_ORIGINS` — comma-separated, no trailing slash. The live relayer allows the production wallet origin and the local Vite dev origins:

```
https://strandedtoken.trade,http://localhost:5173,http://127.0.0.1:5173
```

Do not add `https://gas-rescue.onrender.com`. That host is not on the allowlist, and rescue requests from it are blocked. CORS is read at boot, so restart the Relayer after any change.

Demo token on **stranded-relayer-arb** (see `relayer/.env.example`):

- `TOKEN_ADDRESS` — `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C`
- `DEMO_TOKEN` — `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C` (`DEMO_TOKEN` wins). GRTT and gMOCK were delisted Oct 1, 2026.

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

The wallet build reads only variables whose names start with `VITE_`. `VITE_RELAYER_URL` is the Base Relayer origin. `VITE_RELAYER_BASE_URL` is the only alias for that same Base origin. `RELAYER_BASE_URL` is no longer read. Do not put an unprefixed `RELAYER_` name on the static site: a Vite `envPrefix` of `RELAYER_` copies every `RELAYER_*` value from the build environment into the public bundle, including `RELAYER_PRIVATE_KEY`.

The wallet build runs the bundle secret check and fails when a secret-like environment value is present in the output, including base64 and any 16-character slice. A piece shorter than 16 characters is not a split finding. A value joined only in code, such as two string literals concatenated by the program, is not evaluated. An RPC URL is compared only when it carries a key. The compare is the full URL and also the key part of that URL, so the key alone fails, and so do the host and the key when they appear as separate strings. A public host already in the bundle does not fail by itself. The scan reads http and https, and ws and wss, including a `git+https://` URL and a URL glued to escape text, a `%` encoding, or a letter or digit. A backtick ends a URL. A `//` that belongs to another scheme, such as s3 or ipfs, is not a provider URL. A common or short user word, such as anonymous, is not a key part. A password, or high-entropy userinfo, is. A value is skipped only when that exact string is listed in `wallet/secretScanAllowlist.txt`, and only after the name is checked. That value list never skips `RELAYER_PRIVATE_KEY`, `ADMIN_SECRET`, or a name containing `API_KEY`, `APIKEY`, `ACCESS_TOKEN`, `PASSWD`, `PASSWORD`, `CREDENTIAL`, `PHRASE`, `MNEMONIC`, `SEED`, `PRIVATE`, `PRIV_KEY`, `PRIVKEY`, `SIGNER_KEY`, `SIGNER`, `RELAYER_KEY`, `SECRET`, `KEY` as its own name part, or `PK` as its own name part. CamelCase parts count, so `privKey` and `signerKey` are covered. `AUTH_TOKEN`, `SESSION_TOKEN`, and `GITHUB_TOKEN` are never skipped. A 64-hex value under any secret-like name is never skipped, whatever the list says. A keyed provider URL cannot be listed: the allowlist parser rejects it. An explorer `/tx/` link fails unless that exact URL is listed and its transaction hash is listed too. An explorer `/address/` link cannot be listed. A `?key=` URL fails unless that exact URL is listed. A name containing `TOKEN` is still checked. A listed public address under a `TOKEN_ADDRESS` name passes. A public non-address value, such as a symbol, passes only when that exact value is listed. A 64-hex value under any name containing `TOKEN` does not pass, including a bytes32 under `VITE_TOKEN_ID`. Renaming that variable, for example to `VITE_ASSET_ID`, is the workaround, and that exact value must be listed. Any new address whose name contains `TOKEN` must be added to `wallet/secretScanAllowlist.txt` in the same change, or the deploy build fails. The shape `0x` plus 40 hex digits is not an exemption. A `RELAYER_*` lookalike name is skipped only when that exact name is listed. A run of BIP-39 English list words is flagged when a 12, 15, 18, 21, or 24 word window has a valid checksum. A random run trips that check often: about 1 in 16 at 12 words, and more often as the run gets longer. Bundling a BIP-39 wordlist, such as viem's English list, fails the build. Check the static site environment in the Render dashboard before merging, and remove secret-like names from that build. The check does not try to catch deliberate obfuscation: hex text beyond the plain compare, reversed text, `\u` escapes, `fromCharCode`, gzip, or UTF-16. The control that keeps those build values out of the client is `envPrefix` set to `['VITE_']`.

## 4. Custom domain

The static site `stranded` serves the live wallet at https://strandedtoken.trade. `www.strandedtoken.trade` redirects to that apex. https://gas-rescue.onrender.com remains the Render origin host, and rescue requests from it are blocked by CORS.

To attach another domain: Render → **stranded** → **Custom Domains**, add the DNS record Render shows, and wait until HTTPS is **Issued**. Add `https://` that host to Relayer `CORS_ORIGINS` and restart the Relayer.

MetaMask shows the HTTPS origin on permit/order prompts. `http://` on a public domain will fail.

## 5. Check it

```
curl -sS https://stranded-relayer-arb.onrender.com/health
```

Expect `ok: true`, `chainId: 421614`, `swap: 0x65e7…`. Then open https://strandedtoken.trade, pick **Arb Sepolia**, connect, quote, sign. Do not use https://gas-rescue.onrender.com for a rescue; the relayer will not send `Access-Control-Allow-Origin` for that host.

## 6. Points route

`/points` is a client route. A direct load needs the SPA shell from the static host.

Render does not read `wallet/public/_redirects`. That file is published as a static asset and is not a rewrite. `render.yaml` rewrites `/points` and `/*` to `/index.html`. Those Blueprint routes are not applied by a git auto-deploy of the files alone. The wallet build also writes `wallet/dist/points/index.html`, a copy of the shell. Render serves that directory index at `/points` and `/points/`.

After merge to `main`, the static site **stranded** auto-deploys. No dashboard rewrite is required for `/points`.

| | |
|---|---|
| Host | Render static site `stranded` |
| Origin | https://gas-rescue.onrender.com |
| Custom domain | https://strandedtoken.trade |
| Build | `npm ci --prefix wallet && npm run build --prefix wallet` |
| Publish directory | `wallet/dist` |

https://stranded.onrender.com is not this service. The service name is `stranded` and the onrender.com slug is `gas-rescue`, so that hostname has no server and its root is Render's plain-text Not Found.

Syncing the Blueprint (or adding Rewrite `/*` → `/index.html` under the static site's Redirects/Rewrites) installs the general SPA fallback from `render.yaml`. The published `points/index.html` does not depend on that sync.

## Do not

- Put `RELAYER_PRIVATE_KEY` or owner keys in `render.yaml` or git
- Point Arb `VITE_RELAYER_URL_ARB_SEPOLIA` at the Base Relayer
- Change the proven swap / token / router addresses
