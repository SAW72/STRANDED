# Buildathon progress (HackQuest — Arbitrum Open House Singapore Online)

Dated commits / PRs on this file are the Hacky evidence trail. Prior work on `main` alone does not count.

**Judged product:** `GasRescueSwap` (Gas Rescue v1). `StrandedRegistry` remains Phase 2 / optional tease — not in README Live as the deliverable.

**Redeploy / broadcast = Spencer keys only.** Agents never hold keys, never `--broadcast`, never submit to HackQuest.

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
