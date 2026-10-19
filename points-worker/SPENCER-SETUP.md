# Spencer setup

Agents ran none of these steps. Nothing in this change logged into Cloudflare, deployed a Worker, created a D1 database, or set a secret.

Do these yourself, in order, from `points-worker/` unless a step says otherwise. Use `npx wrangler` (the `wrangler` package is pinned in this directory). Do not install a global binary.

1. Run `npx wrangler login`.
2. Run `npx wrangler d1 create stranded-points`. Paste the printed database id into `database_id` in `wrangler.jsonc`, replacing the placeholder. The id is not a secret.
3. DECISION FOR SPENCER: either allowlist tokens, or keep the Base relayer points push off until that question is settled. gMOCK on Base Sepolia may still have a public mint. That was not confirmed on-chain. To allowlist, run `npx wrangler secret put TOKEN_IN_ALLOWLIST` and paste a JSON object or `chainId:address,address;chainId:address` list that you choose. When the secret is unset, the Worker does not check the token. Do not put a token list in `wrangler.jsonc`, this repo, or a commit.
4. Set the RPC URLs with secrets, not dashboard variables and not `wrangler.jsonc`. Run `npx wrangler secret put BASE_SEPOLIA_RPC_URL` for chain 84532 and `npx wrangler secret put ARB_SEPOLIA_RPC_URL` for chain 421614. Use the public RPC URLs you already use for those testnets. Do not commit the URLs. A later `npx wrangler deploy` does not delete secrets.
5. Set `POINTS_MIN_CONFIRMATIONS` to the same whole number from 1 to 128 on both the Worker and the relayer. It defaults to 2 when it is unset. A value of 0, or any other value outside 1 through 128, is logged and treated as 2. The Worker records a rescue only after the receipt is that many blocks deep, counting the receipt block. Until then it returns 425 `awaiting_confirmations`, and the relayer retries. The relayer waits for that same depth before it posts.
   - Worker: `npx wrangler secret put POINTS_MIN_CONFIRMATIONS`
   - Mac relayer process environment: `POINTS_MIN_CONFIRMATIONS`
   - Render dashboard for `stranded-relayer-arb`: `POINTS_MIN_CONFIRMATIONS`
   Leave it unset on both sides to keep 2. A reorg deeper than this depth does not remove a recorded row. The ledger stays append-only. Changing that is a Spencer decision.
6. Run `npx wrangler d1 migrations apply stranded-points --remote`.
7. Run `npx wrangler deploy`. Keep the Worker origin it prints.
8. On your Mac, generate a secret (for example `openssl rand -hex 32`) and set that same value in three places. It must be at least 32 bytes after trimming. Do not paste it into chat, a file in this repo, or a commit.
   - `npx wrangler secret put POINTS_INGEST_SECRET`
   - the Mac relayer environment: `POINTS_INGEST_SECRET`, and `POINTS_API_URL` set to the Worker origin from step 7 (https, no path)
   - the Render dashboard for `stranded-relayer-arb`: `POINTS_INGEST_SECRET` and `POINTS_API_URL` set to that same https origin
9. Restart both relayers: the Mac process, and `stranded-relayer-arb`.
10. Set `VITE_POINTS_API_URL` on the Render static site `stranded` to the Worker origin from step 7, and rebuild that site.

Until both `POINTS_INGEST_SECRET` and `POINTS_API_URL` are set, the relayer hook does nothing and writes no outbox file. `POINTS_API_URL` must be https. `wallet_session` is not scored. Registry finds stay deferred.

The Worker caps reads of `GET /points` and `GET /points/leaderboard` inside one isolate at 30 per minute per caller. That map does not survive another isolate, and it keys a full IPv6 address rather than a /64. Add a rate-limit rule in the Cloudflare dashboard for those two paths, counted by IP, with IPv6 grouped as a /64, at the same 30-per-minute pace. This covers the isolate cap and the /64 gap. Agents did not create that rule. Spencer applies it.

DECISION FOR SPENCER: points are recorded for the relayer hot wallet (`relayer_job`, 50 per rescue) and that wallet is included on the leaderboard. Leave this as it is, or decide later that those rows should be hidden. This setup does not change that behavior.

`relayer/scripts/backfill-points.mjs` can replay `txHash` values from `rescues.jsonl` after step 9. Agents did not run it.

Points are recorded for activity. The points disclaimer in the wallet is unchanged.
