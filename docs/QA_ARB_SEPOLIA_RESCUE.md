# QA runbook — Arb Sepolia rescue (Spencer-watchable)

**Arb-first.** HackQuest / buildathon judged product is **GasRescueSwap only** on Arbitrum Sepolia `421614`. Base Sepolia is secondary. Tracking: [issue #24](https://github.com/SAW72/STRANDED/issues/24). Progress: [BUILDATHON_PROGRESS.md](BUILDATHON_PROGRESS.md) Day-4.

Scripted **read-only** checks first, then optional **Spencer-keys-only** sign / broadcast. No agent keys. No `--broadcast` from CI or Cursor. No HackQuest submit. No mainnet. Permit2 stays **off**. Do not treat `StrandedRegistry` as the demo.

**Judged product:** `GasRescueSwap` v1 at [`0x65e712222745A8FCCbF038A90Fa75caB0867993D`](https://sepolia.arbiscan.io/address/0x65e712222745A8FCCbF038A90Fa75caB0867993D) (Arb Sepolia `421614`).

**Relayer:** https://stranded-relayer-arb.onrender.com — **KNOW** healthy (`live`, `stubRpc=false`) as of 2026-09-17.  
**Relayer hot wallet:** `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` — **KNOW** ~**0.015 ETH**; needs **~0.10 ETH** on Arb Sepolia before a live submit (Spencer / Chain Ops).

### KNOW gaps (2026-09-17)

| Item | Status | Owner |
| --- | --- | --- |
| Relayer health | Live, `stubRpc=false`, chain `421614`, swap `0x65e7…993D` | — |
| Hot wallet ETH | ~0.015 vs ~0.10 — live submit blocked | Spencer / Chain Ops |
| Fee quote | **MATCH** current Relayer math: **1% of `tokenIn`** service fee; **~20%** swapped for gas (not a fee); **100 bps** slip fail-closed. USD floor/cap/skip is deferred — **not** a live Relayer bug. Do **not** invent Sepolia USD prices. | Relayer Backend (do not rewrite fee math here) |
| Live vs tip | Live lacks `rescueReceipt` + `CANONICAL_PERMIT2()`. Judged v1 `rescueWithPermit` still OK | Optional Spencer redeploy |
| Lens | Not on-chain. `HackQuestStatus` constructs in-script | Optional Spencer `DeployGasRescueLens` |
| Registry | Merged (PR #23); **not** judged | — |

---

## 0. Constraints (do not skip)

| Rule | Detail |
| --- | --- |
| Testnet only | `421614` (primary). Base `84532` is optional / not this runbook. |
| No mainnet | Do not set `--chain-id 1`, mainnet RPC, or mainnet WETH. Scripts revert. |
| No agent broadcast | `InspectGasRescueSwap` and `HackQuestStatus` are read-only. Never add `--broadcast` to them. |
| Spencer keys only | `SignOrder` (sign-only) and `RescueSwap` (`--broadcast`) run on Spencer’s machine with local `.env`. Never paste keys into chat or commit `.env`. |
| Permit2 | Live `permit2Enabled` must stay `false`. Do not call `setPermit2Enabled(true)`. |
| Judged product | GasRescueSwap. Do not treat `StrandedRegistry` as the demo. |
| Lens | Not on-chain unless Spencer already broadcast `DeployGasRescueLens`. `HackQuestStatus` constructs Lens in-script when unset (`lensEphemeral=true`). |

Default RPC (public, no key):

```bash
export ARB_SEPOLIA_RPC_URL="${ARB_SEPOLIA_RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
```

---

## 1. Relayer health (no keys)

```bash
curl -sS https://stranded-relayer-arb.onrender.com/health
# aliases that return the same liveStatus blob:
curl -sS https://stranded-relayer-arb.onrender.com/v1/health
curl -sS https://stranded-relayer-arb.onrender.com/
```

**Expect** (shape; `blockNumber` moves):

```json
{
  "ok": true,
  "live": true,
  "stubRpc": false,
  "chainId": 421614,
  "swap": "0x65e712222745A8FCCbF038A90Fa75caB0867993D",
  "swapCode": true,
  "relayer": "0x8240124dc78a27c80354Ca813Df12aa2888A9AF6",
  "rpc": "live"
}
```

Fail closed if `ok` is not true, `chainId` ≠ `421614`, `stubRpc` is true, or `swap` / `relayer` differ from the table above. Free Render services spin down after ~15 minutes idle — retry once if the first request is slow.

---

## 2. Relayer hot wallet ETH (~0.10)

```bash
cast balance 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6 \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --ether
```

**Expect ≥ 0.10 ETH** before a live `rescueWithPermit`. Below that, quotes may still work; the submit will fail when the hot key cannot pay gas. Read 2026-09-14: **~0.015 ETH** — Spencer top-up required before a judged live job.

Spencer tops up **Arb Sepolia** ETH only (not mainnet). Arbiscan: https://sepolia.arbiscan.io/address/0x8240124dc78a27c80354Ca813Df12aa2888A9AF6

---

## 3. Inspect live swap (read-only Foundry)

```bash
forge script script/InspectGasRescueSwap.s.sol:InspectGasRescueSwap \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
```

**Do not** pass `--broadcast` or a private key.

**Expect:**

| Field | Value |
| --- | --- |
| `chain` | `421614` |
| `swap` | `0x65e712222745A8FCCbF038A90Fa75caB0867993D` |
| `owner` | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` |
| `paused` | `false` |
| `permit2` | `0x0000…0000` |
| `permit2Enabled` | `false` |
| `relayer allowed` | `true` (hot `0x8240…9AF6`) |
| `GRTT allowed` / `eip2612` | `true` (`0x5649fF51123D534044aA7E6cBc8762698Ffed713`) |
| `gMOCK allowed` | `true` |
| `router allowed` | `true` (`0x680410c7f64e06EB7e80dc7B5c149f7855e225A8`) |
| `setPermit2 is F-1 immutable` | `true` |

**Known live-vs-tip drift (do not claim redeploy):** `has CANONICAL_PERMIT2 getter` and `has rescueReceipt` are **false** on 2026-09-14 live bytecode. The script prints a `DRIFT` line. See [REDEPLOY-GASRESCUESWAP.md](REDEPLOY-GASRESCUESWAP.md) — Spencer only.

---

## 4. HackQuestStatus — probe vs real-rescue preflight

Day-3 fail-closed Lens: **`amountIn == 0` is a probe**. Individual flags still populate. `userFunded=false`, `ready=false`, `probeOnly=true`. A real rescue needs `HACKQUEST_AMOUNT_IN > 0` **and** `balanceOf(user) >= amountIn`.

### 4a. Probe (default `HACKQUEST_AMOUNT_IN=0`, no keys)

```bash
forge script script/HackQuestStatus.s.sol:HackQuestStatus \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
```

**Expect JSON fields:**

| Field | Probe (`amountIn` 0) |
| --- | --- |
| `product` | `GasRescueSwap` |
| `buildathon` | `2026-09-17-day4` |
| `chainId` | `421614` |
| `swap` | `0x65e7…993D` |
| `boundToLiveArb` | `true` |
| `permit2Enabled` | `false` |
| `permit2Off` | `true` |
| `notPaused` / `relayerOk` / `tokenAllowed` / `tokenEip2612` / `routerAllowed` | `true` on live |
| `amountInPositive` | `false` |
| `probeOnly` | `true` |
| `userFunded` | `false` |
| `ready` | **`false`** (fail-closed; do not treat as a green rescue) |
| `hotWallet` | `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` |
| `hotWalletUnderfunded` | **`true`** while hot ETH &lt; 0.10 (`hotWalletMinWei=1e17`) |
| `feePostureNote` | `match=flat-1pct-tokenIn; amountSwap=20pct-gas-topup-not-fee; slip=100bps-fail-closed; usd-hybrid=deferred-not-a-relayer-bug; owner=Relayer-Backend-do-not-rewrite` |
| `hasRescueReceipt` / `rescueReceiptSupported` / `hasCanonicalPermit2Getter` | `false` on live |
| `liveVsTip` | `live-lacks-rescueReceipt-and-canonicalPermit2-do-not-claim-redeploy` |
| Fixture `nativeTo=0x1111…1111` `grttDemoPathHash` | `0xf2fa57d446a79240cf3043e9e9f82fd28d8719d264bc89de7d81b8eb167b3c47` |

Default `HACKQUEST_USER` is fixture `0x1111…1111` (not a live EOA). That is fine for a probe.

### 4b. Real-rescue preflight (`amountIn > 0`)

Use the **actual stranded user** and a quoted amount (dry-mock `1e18` if that is the job):

```bash
export HACKQUEST_USER=0xYourStrandedUser
export HACKQUEST_NONCE=0
export HACKQUEST_AMOUNT_IN=1000000000000000000
export HACKQUEST_NATIVE_TO=0xYourNativeRecipient

forge script script/HackQuestStatus.s.sol:HackQuestStatus \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
```

**Expect:** `probeOnly=false`, `amountInPositive=true`. `ready=true` only if that user holds ≥ `amountIn` GRTT **and** the other flags stay true. `ready=false` + `userFunded=false` means do not sign / submit yet.

---

## 5. Optional live quote from the Relayer (no keys)

Dry-mock amounts match `ArbSepoliaDemoPath` / wallet fixtures: `amountIn=1e18`, `amountSwap=0.2e18`, `fee=0.01e18`.

```bash
curl -sS -X POST https://stranded-relayer-arb.onrender.com/v1/quotes \
  -H 'Content-Type: application/json' \
  -d '{
    "chainId": 421614,
    "user": "0xYourStrandedUser",
    "tokenIn": "0x5649fF51123D534044aA7E6cBc8762698Ffed713",
    "amountIn": "1000000000000000000",
    "amountSwap": "200000000000000000",
    "to": "0xRemainderRecipient",
    "nativeTo": "0xYourNativeRecipient"
  }'
```

Quote-time fee **MATCH**es issue #24 / Tokenomics: **1% of the tokens you’re rescuing** as the service fee (`feeAmount = amountIn / 100`). About **20%** is swapped into ETH so you have gas after (`amountSwap` default `amountIn / 5` — not a fee). The rest goes to the signed wallet. If the swap would slip more than **1%**, the job cancels and nothing moves. USD floor/cap/skip is **deferred** until real USD quotes exist — not a live Relayer bug. Do not invent Sepolia prices and do not change Relayer fee math from this runbook.

`amountIn=0` is rejected by the Relayer (`insufficient` / request fail) and by the wallet client. Use step 4a for a Lens probe instead.

`pathHash` on a live quote must be `keccak256(swapExact(tokenIn, amountSwap, nativeTo))` — **not** wallet dry `0xbbb…`. `HackQuestStatus` flags `quotedPathIsWalletDryPlaceholder=true` if you pass `HACKQUEST_PATH_HASH=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`.

---

## 6. Sign / submit — Spencer keys only

Two existing scripts. Both refuse any chain except `84532` / `421614`. Neither should run on an agent.

### 6a. Sign only (no broadcast) — `script/SignOrder.s.sol`

Writes `signed-order.json` for the Relayer. Uses `USER_PRIVATE_KEY` (stranded test user). Does **not** start a broadcast.

```bash
# On Spencer's machine only. source .env — never commit.
source .env
forge script script/SignOrder.s.sol:SignOrder \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
```

Required env: `USER_PRIVATE_KEY`, `GAS_RESCUE_SWAP_ADDRESS`, `TOKEN_ADDRESS`, `ORDER_*` (see `.env.example`). `ORDER_SWAP_DATA` = `swapExact(tokenIn, amountSwap, nativeTo)` hex; `pathHash` is `keccak256` of that bytes.

Then Relayer submit (public origin, signed payload — still no Foundry `--broadcast`):

```bash
curl -sS -X POST https://stranded-relayer-arb.onrender.com/v1/rescues \
  -H 'Content-Type: application/json' \
  -d @signed-order.json
```

### 6b. Operator broadcast — `script/RescueSwap.s.sol`

Signs as the user and **broadcasts** `rescueWithPermit` as the allowlisted relayer.

```bash
# Dry-run first (no --broadcast)
forge script script/RescueSwap.s.sol:RescueSwapWithPermit \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614

# Broadcast — Spencer keys only
forge script script/RescueSwap.s.sol:RescueSwapWithPermit \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --broadcast --chain-id 421614
```

Required extra env: `PRIVATE_KEY` = **relayer** hot key (`0x8240…9AF6`), `USER_PRIVATE_KEY` = stranded user. Owner key must not be the relayer key.

`script/Rescue.s.sol` is the **fee-skim harness** (`GasRescue`), not the judged product. Do not use it for this demo.

---

## 7. Pass / fail (Spencer watch list)

| Check | Pass |
| --- | --- |
| Relayer `/health` | `ok`, `421614`, `stubRpc=false`, swap + hot wallet match |
| Hot wallet ETH | ≥ ~0.10 |
| `InspectGasRescueSwap` | Permit2 off, not paused, GRTT + router + relayer allowlisted |
| Probe `HackQuestStatus` | flags green, **`ready=false`**, `probeOnly=true` |
| Funded `HackQuestStatus` | `ready=true` only with `amountIn>0` and a real GRTT balance |
| Live quote | nonzero `amountIn`; path is `swapExact`, not `0xbbb…`; fee MATCH 1% / 20% gas top-up / 100 bps (do not rewrite) |
| Sign / broadcast | Spencer machine only; testnet `421614`; Permit2 never enabled |

Live still **lacks** `rescueReceipt` / `CANONICAL_PERMIT2()`. Day-4 `HackQuestStatus` `liveVsTip` names both. Cite the view path + this gap. Do not claim a swap redeploy. `StrandedRegistry` is not the judged product.

---

## 8. Addresses (Arb Sepolia)

| Role | Address |
| --- | --- |
| GasRescueSwap (judged) | `0x65e712222745A8FCCbF038A90Fa75caB0867993D` |
| Owner | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` |
| Relayer hot | `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` |
| WETH | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
| GRTT | `0x5649fF51123D534044aA7E6cBc8762698Ffed713` |
| gMOCK | `0x30006e29a23c713070136F56db1BDf2A8B82B318` |
| Mock router | `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` |
| Relayer URL | https://stranded-relayer-arb.onrender.com |

---

## 9. Do not

- `--broadcast` on `HackQuestStatus` or `InspectGasRescueSwap`
- Enable Permit2
- Use mainnet RPC / chain id 1
- Submit to HackQuest from an agent
- Fund or sign with keys that are not Spencer’s
- Treat `amountIn=0` `ready` as a go (it is never ready after Day-3)
- Rewrite Relayer fee quote math (issue #24 MATCH: keep 1% / 20% gas top-up / 100 bps; USD-hybrid deferred, not a Relayer bug)
- Treat `StrandedRegistry` as the judged product
