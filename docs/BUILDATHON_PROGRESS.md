# Buildathon progress (HackQuest — Arbitrum Open House Singapore Online)

Dated commits / PRs on this file are the Hacky evidence trail. Prior work on `main` alone does not count.

**Judged product:** `GasRescueSwap` (Gas Rescue v1) on **Arb Sepolia `421614`**. Base Sepolia is secondary. `StrandedRegistry` remains Phase 2 / optional tease — merged, not judged, not in README Live as the deliverable. Tracking: [issue #24](https://github.com/SAW72/STRANDED/issues/24).

**Redeploy / broadcast = Spencer keys only.** Agents never hold keys, never `--broadcast`, never submit to HackQuest.

## 2026-09-14 — Wallet UX rebase onto Day-2 main (PR #2)

**PR:** https://github.com/SAW72/STRANDED/pull/2 (branch `cursor/wallet-ux-base-sepolia-0413`)

Rebased onto `main` @ `e5905ac` (PR #21 Day-2). Ancestor includes Day-1 `1c98602` (PR #20). No merge. No duplicate PR.

Day-2 content kept (`ArbSepoliaDemoPath`, `HackQuestStatus`, Lens consumer, `VITE_GAS_RESCUE_LENS_ADDRESS`). Wallet UX demo-path notes kept: live Arb Relayer origin documented with **empty** URL fields (fixture-safe), Confirm-details / `POST /v1/quotes` / `StewardGasRescue` / `nativeTo` in the root README, CI job **Wallet build + test**.

No keys. No broadcast. No mainnet.

## 2026-09-14 — Day-1 Arb Sepolia (visible, non-docs-only)

**PR:** https://github.com/SAW72/STRANDED/pull/20 (branch `cursor/buildathon-day1-arb-sepolia-ee4f`)

### What shipped

- `GasRescueLens` — view helper bound to one `GasRescueSwap`. One-call `status`, allowlists, `rescueReadiness`, EIP-712 `hashOrder` / domain, and bytecode-selector probes (`CANONICAL_PERMIT2` getter, `rescueReceipt`, F-1 `Permit2Immutable`).
- Chain-guarded `script/DeployGasRescueLens.s.sol` (421614 primary, 84532 optional). `prepare()` prints constructor calldata without a key.
- Read-only `script/InspectGasRescueSwap.s.sol` (no keys, no broadcast).
- Foundry fork smokes: `test/fork/ArbSepoliaLive.t.sol` (skip if `ARB_SEPOLIA_RPC_URL` unset) and optional Base `test/fork/BaseSepoliaLive.t.sol`.
- Redeploy checklist for live vs tip drift: [REDEPLOY-GASRESCUESWAP.md](REDEPLOY-GASRESCUESWAP.md).

### Arb Sepolia addresses touched (read / documented — not redeployed)

| Role | Address |
| --- | --- |
| **GasRescueSwap (judged)** | [`0x65e712222745A8FCCbF038A90Fa75caB0867993D`](https://sepolia.arbiscan.io/address/0x65e712222745A8FCCbF038A90Fa75caB0867993D) |
| Owner | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` |
| Relayer hot wallet | `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` |
| WETH | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
| Demo token **GRTT** | `0x5649fF51123D534044aA7E6cBc8762698Ffed713` |
| Also allowlisted gMOCK | `0x30006e29a23c713070136F56db1BDf2A8B82B318` |
| Mock router | `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` |
| GasRescueLens | _not deployed — Spencer `DeployGasRescueLens` + `--broadcast` only_ |

Live read (2026-09-14): `paused=false`, `permit2=address(0)`, `permit2Enabled=false`, relayer allowlisted, owner ≠ relayer, GRTT + gMOCK EIP-2612 allowlisted, router allowlisted. F-1 `setPermit2` reverts `Permit2Immutable`. Missing vs tip: `CANONICAL_PERMIT2()` getter (F-5) and `rescueReceipt` (registry proof).

### Base Sepolia (documented, not the Day-1 primary)

| Role | Address |
| --- | --- |
| GasRescueSwap | [`0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`](https://sepolia.basescan.org/address/0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688) |

### On-chain deploys performed by the agent

**None.** No `--broadcast`. No keys.

### Spencer next (optional)

1. `forge test -vv` (already required green on the PR).
2. Fork evidence: `ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc forge test --match-path 'test/fork/*' -vv`
3. Inspect live: `forge script script/InspectGasRescueSwap.s.sol:InspectGasRescueSwap --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614`
4. If Lens should be on-chain for wallet/HackQuest: `prepare()` then `--broadcast` with Spencer keys only (`DeployGasRescueLens`, chain 421614). Paste the new address into README Live (Lens row only — do not move Registry into Live).
5. If F-5/F-6 + `rescueReceipt` must be on the judged swap: follow [REDEPLOY-GASRESCUESWAP.md](REDEPLOY-GASRESCUESWAP.md). Do not claim a swap redeploy until it is broadcast and the Live table is updated.

## 2026-09-14 — Day-2 Lens consumer + Arb demo path registry (visible, non-docs-only)

**PR:** https://github.com/SAW72/STRANDED/pull/21 (branch `cursor/buildathon-day2-arb-sepolia-45f3`)

### What shipped

- **`ArbSepoliaDemoPath`** — known-good Arb Sepolia mock-router path for **GRTT / gMOCK → WETH/native**. Same formula as the live Relayer: `pathHash = keccak256(abi.encodeWithSelector(swapExact, tokenIn, amountSwap, nativeTo))`. Wallet dry `0xbbb…` is labeled a placeholder and rejected as a live path.
- **`GasRescueLens.hackQuestReport`** — one-call consumer of Day-1 Lens read paths: status, GRTT demo readiness (Permit2-off fail-closed), `rescueReceiptOrMissing` (view path; live bytecode still lacks the getter), F-1/F-5 hints, and computed GRTT/gMOCK demo `pathHash`es.
- **`script/HackQuestStatus.s.sol`** — read-only Foundry script. Prints HackQuest-ready JSON. Constructs Lens in-script when `GAS_RESCUE_LENS_ADDRESS` is unset. **No keys. No `--broadcast`.**
- Wallet helpers only (`wallet/src/lib/demoPath.ts`, `wallet/src/lib/lens.ts`): same path formula + Lens ABI. No UI rewrite. Fixtures stay dry `0xbbb…`.
- Tests: `test/ArbSepoliaDemoPath.t.sol`, Lens/script unit tests, optional live fork assertion that live still lacks `rescueReceipt`.

### RescueReceipt (tip vs live — do not claim redeploy)

| Surface | Live Arb `0x65e7…` (2026-09-14) | Tip `src/GasRescueSwap.sol` |
| --- | --- | --- |
| `rescueReceipt(user, nonce)` | **Missing** (empty revert) | Written on success |
| Lens `rescueReceiptOrMissing` | `supported=false` | `supported=true` (empty until a job) |
| `HackQuestStatus` JSON `liveVsTip` | `live-lacks-rescueReceipt-do-not-claim-redeploy` | `tip-has-rescueReceipt` |

Judges can cite the **view path** and the documented gap. The judged swap was **not** redeployed in this PR.

### Arb Sepolia path (relayer / wallet)

Encoding (live mock router `0x6804…` = `MockSwapRouter.swapExact`):

```
swapData = abi.encodeWithSelector(swapExact(address,uint256,address), tokenIn, amountSwap, nativeTo)
pathHash = keccak256(swapData)
```

Dry-mock amounts (same as wallet fixtures): `amountIn=1e18`, `amountSwap=0.2e18`, `fee=0.01e18`, remainder `0.79e18`. `pathHash` binds `nativeTo` — compute per quote. Print hashes via `HackQuestStatus` (`HACKQUEST_NATIVE_TO`).

Fixture `nativeTo=0x1111…1111` hashes (read-only `HackQuestStatus` on Arb RPC, **no broadcast**; Lens address in that run is ephemeral):

| Token | pathHash |
| --- | --- |
| GRTT | `0xf2fa57d446a79240cf3043e9e9f82fd28d8719d264bc89de7d81b8eb167b3c47` |
| gMOCK | `0x8b4de67c75e10145cd31889f5f4bb75938d269e2147e0a00ad9b82bc2c9a8665` |

Supported demo tokens: **GRTT** `0x5649…d713`, **gMOCK** `0x3000…B318`. Destination of the swap slice is native/WETH `0x980B…7c73` (router `payAmount`), remainder ERC-20 still goes to signed `to` (move-out).

### On-chain deploys performed by the agent

**None.** No `--broadcast`. No keys. No HackQuest submit.

### Spencer next (optional)

1. `forge test -vv`
2. `ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc forge test --match-path 'test/fork/*' -vv`
3. `forge script script/HackQuestStatus.s.sol:HackQuestStatus --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614` (no `--broadcast`)
4. Lens on-chain still optional: `DeployGasRescueLens` Spencer keys only, then set `GAS_RESCUE_LENS_ADDRESS` / `VITE_GAS_RESCUE_LENS_ADDRESS`.
5. Swap redeploy (F-5 getter + live `rescueReceipt`) still [REDEPLOY-GASRESCUESWAP.md](REDEPLOY-GASRESCUESWAP.md) — Spencer only.

## 2026-09-14 — Day-3 readiness fail-closed + Arb Sepolia QA runbook (visible, non-docs-only)

**PR:** https://github.com/SAW72/STRANDED/pull/22 (branch `cursor/buildathon-day3-readiness-runbook-e7cd`)

### What shipped

- **`GasRescueLens.rescueReadiness` fail-closed on `amountIn == 0`.** Day-1/Day-2 used `userFunded = (amountIn == 0) || balanceOk`, so a zero-amount probe reported `ready=true` whenever allowlists + Permit2-off lined up. That is not a real rescue (`GasRescueSwap` reverts `InvalidOrder` on `amountIn == 0`). Day-3: `userFunded = amountIn > 0 && balanceOf(user) >= amountIn`. `ready` therefore requires a quoted positive amount **and** a funded user.
- **Probes are preserved.** Callers may still pass `amountIn == 0` (default `HACKQUEST_AMOUNT_IN` on `HackQuestStatus`, live fork smoke, wallet `lensCallArgs` dry `0n`). Individual flags (`notPaused`, `relayerOk`, allowlists, `permit2Off`, nonce) still populate. `userFunded` and `ready` stay **false**. Documented on the Lens struct and in [QA_ARB_SEPOLIA_RESCUE.md](QA_ARB_SEPOLIA_RESCUE.md).
- **`HackQuestStatus` JSON** tagged `2026-09-14-day3` with `amountInPositive` / `probeOnly` so a Spencer-watchable probe is not mistaken for a green job.
- **[QA_ARB_SEPOLIA_RESCUE.md](QA_ARB_SEPOLIA_RESCUE.md)** — exact Relayer health, `InspectGasRescueSwap`, `HackQuestStatus` probe vs funded, hot-wallet **~0.10 ETH**, `SignOrder` / `RescueSwap` (Spencer keys only). Judged swap `0x65e7…993D`. Relayer https://stranded-relayer-arb.onrender.com. Permit2 off. No mainnet.

### Live Arb read (2026-09-14, no broadcast)

`HackQuestStatus` default probe (`amountIn=0`) against `https://sepolia-rollup.arbitrum.io/rpc`: `paused=false`, `permit2Enabled=false`, `permit2Off=true`, allowlist flags true, **`ready=false`**, `probeOnly=true`, `userFunded=false`, `boundToLiveArb=true`, `hasRescueReceipt=false`, `liveVsTip=live-lacks-rescueReceipt-do-not-claim-redeploy`. Relayer `/health` live (`stubRpc=false`) on https://stranded-relayer-arb.onrender.com. Hot wallet `0x8240…9AF6` balance read **~0.015 ETH** — still needs ~0.10 ETH before a live submit.

### Arb Sepolia addresses (unchanged — not redeployed)

Same table as Day-1. Relayer hot `0x8240…9AF6` still needs ~0.10 ETH for a live submit.

### On-chain deploys performed by the agent

**None.** No `--broadcast`. No keys. No HackQuest submit.

### Spencer next (optional)

1. `forge test -vv`
2. Relayer health: `curl -sS https://stranded-relayer-arb.onrender.com/health`
3. Follow [QA_ARB_SEPOLIA_RESCUE.md](QA_ARB_SEPOLIA_RESCUE.md) (Inspect + HackQuestStatus probe, then funded preflight).
4. Live rescue: Spencer keys only (`SignOrder` then Relayer `POST /v1/rescues`, or `RescueSwap` `--broadcast`). Top up the hot wallet first if `cast balance` &lt; ~0.10 ETH.
5. Lens on-chain / swap redeploy still optional and Spencer-only (Day-1 / Day-2 checklists).

## 2026-09-17 — Day-4 Arb Sepolia HackQuest readiness (visible, non-docs-only)

**Issue:** [#24](https://github.com/SAW72/STRANDED/issues/24) — Arb Sepolia buildathon readiness (HackQuest).  
**QA:** [QA_ARB_SEPOLIA_RESCUE.md](QA_ARB_SEPOLIA_RESCUE.md)

**Judged product remains `GasRescueSwap`.** `StrandedRegistry` is merged on `main` (PR #23 @ `035d841`) and is **not** the judged deliverable.

### What shipped

- **Arb-first docs** — README Live, this file, and the QA runbook state the 2026-09-17 KNOW snapshot: Relayer live, hot-wallet underfund, fee posture, live-vs-tip drift, Lens not on-chain, Registry not judged.
- **`HackQuestStatus` JSON tagged `2026-09-17-day4`.** Read-only fields (no keys, no broadcast):
  - `hotWallet` / `hotWalletWei` / `hotWalletMinWei` / `hotWalletUnderfunded` — live hot `0x8240…9AF6` vs **0.10 ETH** floor.
  - `feePostureNote` — issue #24 / Tokenomics **MATCH** with current Relayer math (not a mismatch). Keep `feeAmount = amountIn / 100` (1%), `amountSwap` default `amountIn / 5` (~20% gas top-up, **not** a fee), 100 bps slip fail-closed. USD floor/cap/skip is **deferred** until real USD quotes exist — do not invent Sepolia prices and do **not** treat that deferral as a live Relayer bug. Relayer Backend owns any future rewrite; this script does not implement it.

**Plain English (Tokenomics):** “We take 1% of the tokens you’re rescuing as the service fee. About 20% is swapped into ETH so you have gas after. The rest goes to your chosen wallet. If the swap would slip more than 1%, the job cancels and nothing moves.”
  - `liveVsTip` — names both missing tip surfaces (`rescueReceipt` + `CANONICAL_PERMIT2()`). Live judged v1 `rescueWithPermit` is still OK. Do not claim a swap redeploy.

### Live Arb read (2026-09-17, no broadcast)

`HackQuestStatus` default probe (`amountIn=0`) against `https://sepolia-rollup.arbitrum.io/rpc`: `paused=false`, `permit2Enabled=false`, `permit2Off=true`, allowlist flags true, **`ready=false`**, `probeOnly=true`, `userFunded=false`, `boundToLiveArb=true`, `hasRescueReceipt=false`, `hasCanonicalPermit2Getter=false`, `liveVsTip=live-lacks-rescueReceipt-and-canonicalPermit2-do-not-claim-redeploy`, `hotWalletUnderfunded=true` (`hotWalletWei=14957321211204000` ≈ 0.015 ETH vs `hotWalletMinWei=0.10`), `feePostureNote` MATCH 1% / 20% gas top-up / 100 bps. Relayer `/health` live (`stubRpc=false`) on https://stranded-relayer-arb.onrender.com.

### KNOW snapshot (2026-09-17, no broadcast)

| Item | Status |
| --- | --- |
| Relayer https://stranded-relayer-arb.onrender.com | **Healthy** — `ok`, `live`, `stubRpc=false`, chainId `421614`, swap `0x65e712222745A8FCCbF038A90Fa75caB0867993D` |
| Hot wallet `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` | **~0.015 ETH** — needs **~0.10 ETH** before a live submit (Spencer / Chain Ops) |
| Fee quote | **MATCH** current Relayer math (not a mismatch): 1% of `tokenIn`; ~20% gas top-up (not a fee); 100 bps fail-closed. USD floor/cap/skip deferred until real USD quotes. Do not rewrite here |
| Live swap `0x65e7…993D` | Lacks tip `rescueReceipt` / `CANONICAL_PERMIT2()` getter. Judged v1 `rescueWithPermit` still OK |
| `GasRescueLens` | **Not on-chain.** `HackQuestStatus` constructs Lens in-script (`lensEphemeral=true`) |
| `StrandedRegistry` | Merged; **not** judged product |

### On-chain deploys performed by the agent

**None.** No `--broadcast`. No keys. No Relayer fee rewrite. No Permit2 enable. No mainnet. No HackQuest submit.

### Spencer next (optional)

1. `forge test -vv`
2. Relayer health: `curl -sS https://stranded-relayer-arb.onrender.com/health`
3. `forge script script/HackQuestStatus.s.sol:HackQuestStatus --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614` (no `--broadcast`) — expect `hotWalletUnderfunded=true` until the hot wallet is topped up, `feePostureNote` present, `liveVsTip=live-lacks-rescueReceipt-and-canonicalPermit2-do-not-claim-redeploy`
4. Follow [QA_ARB_SEPOLIA_RESCUE.md](QA_ARB_SEPOLIA_RESCUE.md). Top up the hot wallet (~0.10 ETH Arb Sepolia) before any live submit.
5. Lens on-chain / swap redeploy still optional and Spencer-only.
