# Arb Sepolia relayer

Testnet relayer for GasRescueSwap on Arbitrum Sepolia (chain id `421614`). It serves `POST /v1/quotes` and `POST /v1/rescues`. The process binds `0.0.0.0:$PORT` on Render and `127.0.0.1` locally.

Runtime secrets stay in the environment. Do not put `RELAYER_PRIVATE_KEY` in a file or in git. This service does not broadcast from unit tests.

## Rescue limits

GRTT can be minted by anyone, and each successful rescue pays gas from the router inventory (up to 0.001 ETH). These limits are a **mitigation** so one wallet or one IP cannot empty that inventory during the hackathon. They are not a substitute for restricting GRTT `mint` or capping router payouts. That change belongs to the contract / token work.

Defaults apply when the variables are **unset**, including on the live Render service:

| Variable | Default | Disable |
| --- | --- | --- |
| `RESCUE_LIMIT_PER_WALLET` | `1` successful rescue | `0`, `off`, `false`, `disabled`, `none` |
| `RESCUE_LIMIT_PER_IP` | `3` successful rescues | same |
| `RESCUE_LIMIT_WINDOW_MS` | `14400000` (4 hours) | — |
| `RESCUE_LIMIT_WINDOW_HOURS` | used only when `RESCUE_LIMIT_WINDOW_MS` is unset | — |
| `TRUSTED_PROXY_HOPS` | `1` | `0` uses the rightmost `X-Forwarded-For` hop |

`RESCUE_LIMIT_WINDOW_MS` wins over hours. A blank value is treated as unset.

The IP default is 3, not 1. One judge needs a single rescue, which the wallet limit already covers. Three leaves room for a second wallet or a teammate on the same network, and still stops one address from taking the ~19 max payouts that drain the router. Set `RESCUE_LIMIT_PER_IP=0` only if judges share a VPN and hit the backstop.

Only a **successful** broadcast counts. A reverted simulation, a rejected quote, or an in-flight rescue that fails does not count. A rescue which broadcasts and then reverts on chain still uses up the wallet and IP slot. A second request while the first broadcast is still running gets 429 with an "already in progress" message and a short `retryAfter` (30 seconds), not the 4-hour window.

Limits are checked after the body is validated and **before** quote RPC, nonce reservation, simulation, or broadcast. `GET /health` stays 200. The kill switch still returns `503` `relayer_paused` before the limiter runs. CORS is unchanged: allowed origins are echoed, including on 429 and 400.

Counts are stored in `$DATA_DIR/rescue-limits.json` (same directory as the rescue log). The file holds wallet addresses, client IPs, and timestamps only. A new process on the same disk reloads them. Render's filesystem is ephemeral, so a deploy or service restart starts a fresh window; the limit still holds for the life of the running instance. If the file is missing or unreadable, the process starts from an empty window and logs `rescue_limit_load ignored`.

### Client IP

Render fronts the service with Cloudflare. A client-supplied leftmost `X-Forwarded-For` value is spoofable, because the proxy appends instead of replacing the header. The rightmost value is usually a shared Cloudflare address.

1. Use `CF-Connecting-IP` when it is a single IP (Cloudflare overwrites it). `True-Client-IP` is ignored.
2. Otherwise walk `X-Forwarded-For` from the right, skip `TRUSTED_PROXY_HOPS` (default 1), and take that hop.
3. If the chain is shorter than the trusted suffix, use the rightmost hop.
4. With no forwarding headers, use the socket address. Addresses are normalized (expanded `::`, lowercase, no zone id, brackets, or port). IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is the IPv4 address.
5. IPv6 clients share one rate-limit bucket per `/64`. IPv4 stays one bucket per address.

### 429 body

```json
{
  "ok": false,
  "error": "rate_limited_wallet",
  "message": "This wallet already got a rescue. You can try again at 2026-10-01T22:00:00.000Z.",
  "retryAfter": 14400,
  "retryAt": "2026-10-01T22:00:00.000Z"
}
```

`error` is `rate_limited_wallet` or `rate_limited_ip`. `retryAfter` is seconds. The response also sets `Retry-After` to that number. The IP message is `Too many rescues from this network. You can try again at <ISO time>.` When the wallet cap is higher than 1, the wallet message is `Too many rescues from this wallet. You can try again at <ISO time>.` A rescue already in progress keeps the same timestamp fields and says you can try again at that time.

`GET /health` includes the configured caps (not who has used them):

```json
"rescueLimits": {
  "perWallet": 1,
  "perIp": 3,
  "windowMs": 14400000,
  "walletEnabled": true,
  "ipEnabled": true,
  "trustedProxyHops": 1
}
```

A disabled cap is `null` and its `*Enabled` flag is `false`.

## Quote and rescue errors

Bad input is HTTP 400 with `{ "ok": false, "error": "<code>", "message": "..." }`. No stack traces, RPC URLs, or secrets.

| Case | Code | Message |
| --- | --- | --- |
| Empty body, invalid JSON, or a non-object | `invalid_json` | That request doesn't look right. Please try again. |
| Missing wallet on a quote or rescue | `missing_user` | A wallet address is required. |
| Malformed wallet address | `invalid_address` | That wallet address doesn't look right. |
| Malformed token address | `invalid_address` | That token address doesn't look right. |
| Missing, non-numeric, negative, or zero amount | `invalid_amount` | That amount isn't valid. Please check it and try again. |
| The amount split does not fit | `invalid_amount_split` | That amount isn't valid. Please check it and try again. |
| Chain other than Arbitrum Sepolia | `wrong_chain` | This rescue only works on Arbitrum Sepolia. |
| Token has no contract code | `token_not_contract` | That token isn't supported for rescue. |
| Amount is too small to pay gas | `amount_too_small` | That amount is too small to rescue. Please try a larger amount. |
| Amount is larger than the wallet balance | `insufficient_balance` | That amount is larger than this wallet's balance. |
| Kill switch | `relayer_paused` | Rescues are paused right now. Please try again later. |
| Not enough gas set aside for the rescue | `quote_unavailable` | There isn't enough gas available for this rescue right now. Please try again later. |
| Upstream network failure | `upstream_unavailable` | The network is unavailable right now. Please try again in a moment. |
| Broadcast did not go through | `broadcast_failed` | The rescue didn't go through. Please try again in a moment. |
| Quote no longer matches the signed request | `path_mismatch` | This rescue quote doesn't match the request. Please get a new quote and try again. |
| Signed route is not the one this service uses | `router_not_allowed` | This rescue route isn't available. Please get a new quote and try again. |
| The rescue check failed before broadcast | `simulation_failed` | This rescue wouldn't go through right now. Please get a new quote and try again. |

`quote_unavailable` and `upstream_unavailable` stay HTTP 502. The kill switch stays HTTP 503. An unexpected crash is HTTP 500 `request_failed` with no other fields.

## Broadcast retry

After simulation succeeds, `withBroadcastRetry` retries nonce-too-low, replacement-underpriced, and transient HTTP/RPC failures. viem's `BaseError.walk` takes a predicate; passing `true` throws and used to skip the retry. Contract reverts are not retried.

`BROADCAST_MAX_ATTEMPTS` (default 3) and `BROADCAST_RETRY_BASE_MS` (default 200) are unchanged.
