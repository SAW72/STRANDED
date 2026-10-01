# QA runbook — Arb Sepolia rescue (Spencer-watchable)

**Arb-first.** HackQuest / buildathon judged product is **GasRescueSwap only** on Arbitrum Sepolia `421614`. Base Sepolia is secondary. Tracking: [issue #24](https://github.com/SAW72/STRANDED/issues/24). Progress: [BUILDATHON_PROGRESS.md](BUILDATHON_PROGRESS.md) Day-5.

Scripted **read-only** checks first, then optional **Spencer-keys-only** sign / broadcast. No agent keys. No `--broadcast` from CI or Cursor. No HackQuest submit. No mainnet. Permit2 stays **off**. Do not treat `StrandedRegistry` as the demo.

**Judged product:** `GasRescueSwap` v1 at [`0x65e712222745A8FCCbF038A90Fa75caB0867993D`](https://sepolia.arbiscan.io/address/0x65e712222745A8FCCbF038A90Fa75caB0867993D) (Arb Sepolia `421614`).

**Relayer:** https://stranded-relayer-arb.onrender.com — **KNOW** healthy (`live`, `stubRpc=false`) as of 2026-09-17.  
**Relayer hot wallet:** `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` — **KNOW** **0.214961419621579600 ETH** (`cast balance`, 2026-10-01), above the **~0.10 ETH** live-submit floor. `HackQuestStatus` recommends `live-submit-ok-if-user-funded`. The 2026-09-17 reading was ~0.015 ETH.

### KNOW gaps (2026-09-17)

| Item | Status | Owner |
| --- | --- | --- |
| Relayer health | Live, `stubRpc=false`, chain `421614`, swap `0x65e7…993D` | — |
| Hot wallet ETH | 0.214961419621579600 ETH on 2026-10-01 (was ~0.015 on 2026-09-17). Above the 0.10 floor. `recommendedJudgePath=live-submit-ok-if-user-funded` | Spencer / Chain Ops still owns the key |
| Fee quote | **MATCH** current Relayer math: **1% of `tokenIn`** service fee; **~20%** swapped for gas (not a fee); **100 bps** slip fail-closed. USD floor/cap/skip is deferred — **not** a live Relayer bug. Do **not** invent Sepolia USD prices. | Relayer Backend (do not rewrite fee math here) |
| Live vs tip | Live lacks `rescueReceipt` + `CANONICAL_PERMIT2()`. Judged v1 `rescueWithPermit` still OK | Optional Spencer redeploy |
| Lens | Not on-chain. `HackQuestStatus` constructs in-script | Optional Spencer `DeployGasRescueLens` |
| Registry | Merged (PR #23); **not** judged | — |
| Demo video | Exists (README Live). **Do not remake** | — |

---

## Judge path (2026-10-01)

Hot wallet `0x8240…9AF6` holds **0.214961419621579600 ETH** (`cast balance`, 2026-10-01). That is above the 0.10 ETH floor. Read-only `HackQuestStatus` reports `hotWalletUnderfunded=false`, `liveSubmitBlocked=false`, and `recommendedJudgePath=live-submit-ok-if-user-funded`. A live submit still needs a funded user and Spencer's keys. The demo video already exists — **do not remake**.

The 2026-09-17 reading was ~0.015 ETH, and the script then recommended `fixture-demo-no-top-up`. If the hot wallet falls under 0.10 ETH again, that fixture path is the recommendation. Until then, judges use the funded path:

1. `forge test -vv` — offline units + script JSON (CI). Also `forge build` (SignOrder must compile).
2. Wallet: leave Relayer URL empty → labeled **Sample · not live** fixture. Confirm-details still gates. Do not POST fixture signatures.
3. Read-only `HackQuestStatus` (section 4a): expect `buildathon=2026-09-17-day5`, `routerAllowed=true`, `ready=true`, `hotWalletUnderfunded=false`, `liveSubmitBlocked=false`, `recommendedJudgePath=live-submit-ok-if-user-funded`, `demoVideoExists=true`.
4. Read-only `InspectGasRescueSwap` (section 3): Permit2 off, locked router allowlisted, retired open router delisted, drift line.
5. Cite the existing demo video in README Live. Do not remake it.

Live Relayer `/health` and a `POST /v1/quotes` (section 5) are optional evidence. Section 6 (sign / submit) stays Spencer's keys only.

`HackQuestStatus` / Inspect `judgeNote` when underfunded:

```
hot-wallet-underfunded-Spencer-blocked; recommended=fixture-demo-without-top-up; demo-video-exists-do-not-remake
```

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

**Expect ≥ 0.10 ETH** before a live `rescueWithPermit`. Below that, quotes may still work; the submit will fail when the hot key cannot pay gas. Read 2026-09-17: **~0.015 ETH**. Read 2026-10-01: **0.214961419621579600 ETH**. `HackQuestStatus` reports `liveSubmitBlocked=false` and `recommendedJudgePath=live-submit-ok-if-user-funded` while the balance stays at or above 0.10 ETH.

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
| `hot underfunded` / `live submit blocked` | **`false`** on the 2026-10-01 read (0.214961419621579600 ETH). **`true`** if hot ETH later falls under 0.10 |
| `recommended path` | `live-submit-ok-if-user-funded` on that read. `fixture-demo-no-top-up` if the hot wallet falls under 0.10 ETH |
| `GRTT allowed` / `eip2612` | `true` (`0x5649fF51123D534044aA7E6cBc8762698Ffed713`) |
| `gMOCK allowed` | `true` |
| `router` / `router allowed` / `router wei` | `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`, `true`, `19500000000000000` (0.0195 ETH) |
| `retired router` / `retired allowed` / `retired wei` | retired open router `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` (delisted Oct 1, 2026), `false`, `0` |
| `setPermit2 is F-1 immutable` | `true` |

**Known live-vs-tip drift (do not claim redeploy):** `has CANONICAL_PERMIT2 getter` and `has rescueReceipt` are **false** on 2026-09-14 live bytecode. The script prints a `DRIFT` line. See [REDEPLOY-GASRESCUESWAP.md](REDEPLOY-GASRESCUESWAP.md) — Spencer only.

---

## 4. HackQuestStatus — probe vs real-rescue preflight

Day-3 fail-closed Lens: **`amountIn == 0` is a probe**. Individual flags still populate. `userFunded=false`, `ready=false`, `probeOnly=true`. A real rescue needs `HACKQUEST_AMOUNT_IN > 0` **and** `balanceOf(user) >= amountIn`.

### 4a. Default funded preflight (no keys)

```bash
forge script script/HackQuestStatus.s.sol:HackQuestStatus \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
```

Default `HACKQUEST_USER` is GRTT holder `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` and default `HACKQUEST_AMOUNT_IN` is `1e18`. The in-script Lens checks locked router `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`. Set `HACKQUEST_AMOUNT_IN=0` for the Day-3 probe (`ready=false`, `probeOnly=true`).

**Expect JSON fields (default, 2026-10-01):**

| Field | Default funded preflight |
| --- | --- |
| `product` | `GasRescueSwap` |
| `buildathon` | `2026-09-17-day5` |
| `chainId` | `421614` |
| `swap` | `0x65e7…993D` |
| `user` | `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` |
| `amountIn` | `1000000000000000000` |
| `boundToLiveArb` | `true` |
| `permit2Enabled` | `false` |
| `permit2Off` | `true` |
| `notPaused` / `relayerOk` / `tokenAllowed` / `tokenEip2612` / `routerAllowed` | `true` |
| `amountInPositive` | `true` |
| `probeOnly` | `false` |
| `userFunded` | `true` |
| `ready` | **`true`** |
| `hotWallet` | `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` |
| `hotWalletUnderfunded` | **`false`** on the 2026-10-01 read (0.214961419621579600 ETH; floor `hotWalletMinWei=1e17`) |
| `liveSubmitBlocked` | **`false`** while the hot wallet stays at or above 0.10 ETH |
| `recommendedJudgePath` | `live-submit-ok-if-user-funded` |
| `demoVideoExists` | `true` (do not remake) |
| `judgeNote` | `hot-wallet-meets-0.10-ETH-floor; live-submit-still-Spencer-keys-only; fixture-demo-remains-valid` |
| `feePostureNote` | `match=flat-1pct-tokenIn; amountSwap=20pct-gas-topup-not-fee; slip=100bps-fail-closed; usd-hybrid=deferred-not-a-relayer-bug; owner=Relayer-Backend-do-not-rewrite` |
| `hasRescueReceipt` / `rescueReceiptSupported` / `hasCanonicalPermit2Getter` | `false` on live |
| `liveVsTip` | `live-lacks-rescueReceipt-and-canonicalPermit2-do-not-claim-redeploy` |
| Fixture `nativeTo=0x1111…1111` `grttDemoPathHash` | `0xf2fa57d446a79240cf3043e9e9f82fd28d8719d264bc89de7d81b8eb167b3c47` |

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

## H1 — public mint (draft, not signed)

Live GRTT and gMOCK `mint` are public. Neither token has `owner()` or a mint gate. A 0-ETH wallet can mint and rescue. The locked router holds 0.0195 ETH and pays at most 0.001 ETH per rescue (`payAmount()` for the 0.2-token demo slice is 0.0001 ETH). Relayer limits (1 per wallet, 3 per IP, 4 hours) only slow the drain.

Auditor M-1: do not key a per-user payout cap on `swapExact`'s third argument. `GasRescueSwap` does not bind that word to signed `order.user` or `order.nativeTo`. The signer can rotate it. Rejected.

Two auditor options. (1) Restrict mint on both GRTT and gMOCK. No live setter, so this is a new token plus two delists. Owner-only mint is the draft below. A capped public faucet still lets every fresh address take one payout, so it is not used. (2) A global max ETH per hour on the router. The live router has `setMaxPayout`, `setRate`, and `withdrawEth`, and no hourly cap. That needs a new router. Do not edit `script/DeployLockedDemoSwapRouter.s.sol` (separate PR). An hourly cap slows the drain and does not close it. Not chosen.

`script/MigrateH1GatedDemoToken.s.sol` is the owner script. One run deploys `GatedDemoToken` (name "Stranded Demo Token", symbol SDEMO, permit domain "Stranded Demo Token", owner-only mint, 2e18 to `0x5BFd…BA37`) and then calls `setEip2612Token(deployed, true)` and `setTokenAllowed(token, false)` on GRTT and gMOCK, using the address `new` returned. `setTokenAllowed(false)` also clears the EIP-2612 flag on live bytecode. Signer is `0x3046…bA9D`. The script calls `vm.startBroadcast()` with no key in the repo and reverts on Foundry's default sender `0x1804…1f38`.

`cast logs` of `TokenAllowed` and `Eip2612TokenAllowed` from block 300000000 through latest, then `cast call` of `allowedTokens` and `eip2612Tokens`: only gMOCK (block 305436708) and GRTT (block 305485600) are allowed. WETH is not. No third token, so the owner list has no extra delist.

Simulate, no key, no `--broadcast`:

```bash
forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --chain-id 421614 -vv
```

Spencer broadcasts from his machine only, with `--account` / `--sender` equal to the owner, and with `--slow` so each transaction lands before the next one is sent. Do not broadcast from CI or Cursor.

```bash
forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

If that run stops after the CREATE, or after the CREATE and `setEip2612Token`, resume with the address the run printed. Do not deploy a second token.

```bash
EXISTING_TOKEN=<printed address> \
forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

Until he signs, section 4a still expects `tokenAllowed=true` and `ready=true` for the open GRTT holder (`DEMO_TOKEN` unset). After he signs, set one line `DEMO_TOKEN=<deployed>` before the next `HackQuestStatus` run. The in-script Lens then reports `ready=true` for `0x5BFd…BA37` on the new token. Do not paste a nonce-predicted address, and do not retarget `GasRescueLens.LIVE_ARB_GRTT`. The relayer flip is `DEMO_TOKEN` or `TOKEN_ADDRESS`. `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` is a Render env change on the static site `stranded` plus a rebuild. This runbook does not change `render.yaml`. Owner mints after the constructor follow [docs/SDEMO_MINT_LOG.md](SDEMO_MINT_LOG.md): 2 SDEMO per named judge or QA wallet, on request only, with outstanding SDEMO capped at 20 including the constructor mint. Do not change `setRate` or `setMaxPayout` on the router during judging.

A judge using their own wallet needs the owner to mint them the new token. Only `0x5BFd…BA37` is pre-funded with 2e18. `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` is Spencer's demo/QA EOA. It was allowlisted as a relayer in the past. On 2026-10-01 `relayers(address)` on `GasRescueSwap` `0x65e7…993D` returned false for it. The live relayer hot key is `0x8240…9AF6`. ETH out is at most SDEMO `totalSupply()` times 0.0005 ETH, so 2 SDEMO = 0.001 ETH and 20 SDEMO = 0.01 ETH, which is 51% of the router's 0.0195 ETH inventory. Outstanding supply means `totalSupply()`. SDEMO held by the router is never swept and re-minted. Further owner mints stay inside the operating limit of 20, including the constructor mint. The fixture demo (empty Relayer URL) still runs.

`withdrawEth` and `setMaxPayout` exist on the live router. They are a stopgap (pull the 0.0195 ETH, or set the cap to 0). They are not this migration. A public one-per-address faucet would leave the drain open.

---

## 7. Pass / fail (Spencer watch list)

| Check | Pass |
| --- | --- |
| Relayer `/health` | `ok`, `421614`, `stubRpc=false`, swap + hot wallet match |
| Hot wallet ETH | 0.214961419621579600 ETH on 2026-10-01, above the ~0.10 floor. `liveSubmitBlocked=false`. The 2026-09-17 reading was ~0.015 ETH |
| `InspectGasRescueSwap` | Permit2 off, not paused, GRTT + locked router + relayer allowlisted; retired open router not allowlisted |
| Default `HackQuestStatus` | `routerAllowed=true`, **`ready=true`**, `recommendedJudgePath=live-submit-ok-if-user-funded`. `HACKQUEST_AMOUNT_IN=0` is still the probe (`ready=false`) |
| Funded `HackQuestStatus` | `ready=true` only with `amountIn>0` and a real GRTT balance |
| Live quote | nonzero `amountIn`; path is `swapExact`, not `0xbbb…`; fee MATCH 1% / 20% gas top-up / 100 bps (do not rewrite) |
| Sign / broadcast | Spencer machine only; testnet `421614`; Permit2 never enabled |

Live still **lacks** `rescueReceipt` / `CANONICAL_PERMIT2()`. Day-5 `HackQuestStatus` `liveVsTip` names both. Cite the view path + this gap. Do not claim a swap redeploy. `StrandedRegistry` is not the judged product. Do not remake the demo video.

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
| Locked demo router | `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` |
| Retired open router (delisted Oct 1, 2026) | `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` |
| Relayer URL | https://stranded-relayer-arb.onrender.com |

---

## 9. Do not

- `--broadcast` on `HackQuestStatus`, `InspectGasRescueSwap`, or `MigrateH1GatedDemoToken` (Spencer's machine only for the last one)
- Enable Permit2
- Use mainnet RPC / chain id 1
- Submit to HackQuest from an agent
- Fund or sign with keys that are not Spencer’s
- Treat `amountIn=0` `ready` as a go (it is never ready after Day-3)
- Rewrite Relayer fee quote math (issue #24 MATCH: keep 1% / 20% gas top-up / 100 bps; USD-hybrid deferred, not a Relayer bug). Relayer control plane is PR #26 — do not open a competing Relayer PR
- Treat `StrandedRegistry` as the judged product
- Remake the demo video
- Wait for a hot-wallet top-up before judging — use the fixture/demo path
