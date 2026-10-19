# Spencer setup

Agents ran none of these steps. Nothing in this change logged into Cloudflare, deployed a Worker, created a D1 database, or set a secret.

Do these yourself, in order, from `points-worker/` unless a step says otherwise.

1. Run `wrangler login`.
2. Run `wrangler d1 create stranded-points`. Paste the printed database id into `database_id` in `wrangler.jsonc`, replacing the placeholder. The id is not a secret.
3. Set the Worker variables `BASE_SEPOLIA_RPC_URL` (chain 84532) and `ARB_SEPOLIA_RPC_URL` (chain 421614) to the public RPC URLs you already use for those testnets. Do not commit the URLs. Leave `POINTS_INGEST_SECRET` unset until step 6.
4. Run `wrangler d1 migrations apply stranded-points --remote`.
5. Run `wrangler deploy`. Keep the Worker origin it prints.
6. On your Mac, generate a secret (for example `openssl rand -hex 32`) and set that same value in three places. Do not paste it into chat, a file in this repo, or a commit.
   - `wrangler secret put POINTS_INGEST_SECRET`
   - the Mac relayer environment: `POINTS_INGEST_SECRET`, and `POINTS_API_URL` set to the Worker origin from step 5 (no path)
   - the Render dashboard for `stranded-relayer-arb`: `POINTS_INGEST_SECRET` and `POINTS_API_URL` set to that same origin
7. Restart both relayers: the Mac process, and `stranded-relayer-arb`.
8. Set `VITE_POINTS_API_URL` on the Render static site `stranded` to the Worker origin from step 5, and rebuild that site.

Until both `POINTS_INGEST_SECRET` and `POINTS_API_URL` are set, the relayer hook does nothing and writes no outbox file. `wallet_session` is not scored. Registry finds stay deferred.

`relayer/scripts/backfill-points.mjs` can replay `txHash` values from `rescues.jsonl` after step 7. Agents did not run it.

Points are recorded for activity. The points disclaimer in the wallet is unchanged.
