# Redeploy `GasRescueSwap` (testnet only, Spencer keys)

Live Arb Sepolia `0x65e712222745A8FCCbF038A90Fa75caB0867993D` (read 2026-09-14) is **not** current `src/GasRescueSwap.sol`.

No agent has broadcast a replacement. Do not write a new address into README Live until Spencer confirms the tx.

## What live has vs tip

| Check | Live Arb `0x65e7…` | Current source |
| --- | --- | --- |
| `setPermit2` | Reverts `Permit2Immutable` (F-1) | Same |
| `permit2` / `permit2Enabled` | `address(0)` / `false` | Constructor-immutable; default `false` |
| `CANONICAL_PERMIT2()` getter | **Missing** (empty revert) | Public constant (F-5) |
| Constructor Permit2 allowlist | Not observable; live wired `address(0)` | `address(0)` or canonical only (F-5) |
| EIP-2612 user-drop (F-6) | Not a public getter | `_requireExactUserDrop` on both pulls |
| `rescueReceipt` | **Missing** | Written on success (registry proof) |

Base `0x21A1…` is older still: `setPermit2` is `onlyOwner` (pre-F-1), not `Permit2Immutable`. Same Permit2-off policy. Optional to redeploy; Day-1 primary is Arb.

Judged v1 rescue (`rescueWithPermit`, allowlists, pause, EIP-712) still works on live Arb. Redeploy is for F-5 constructor hardening, F-6 user-drop on-chain, and Phase-2 receipts — **not** to replace Gas Rescue with `StrandedRegistry`.

## Script (no agent broadcast)

`script/DeployGasRescueSwap.s.sol` already refuses any chain except 84532 / 421614. Permit2 stays constructor-immutable and **disabled** (`permit2Enabled` starts `false`; do not call `setPermit2Enabled(true)`).

```bash
source .env   # Spencer machine only. Never commit.

# Dry-run (no broadcast)
forge script script/DeployGasRescueSwap.s.sol:DeployGasRescueSwap \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614

# Broadcast — Spencer keys only
forge script script/DeployGasRescueSwap.s.sol:DeployGasRescueSwap \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --broadcast --chain-id 421614
```

Required env: `PRIVATE_KEY` (owner, ≠ relayer), `RELAYER_ADDRESS`, `WETH_ADDRESS`.

Arb Sepolia values (set explicitly; not script defaults):

```
RELAYER_ADDRESS=0x8240124dc78a27c80354Ca813Df12aa2888A9AF6
WETH_ADDRESS=0x980B62Da83eFf3D4576C647993b0c1D7faf17c73
ROUTER_ADDRESS=0x680410c7f64e06EB7e80dc7B5c149f7855e225A8
TOKEN_ADDRESS=0x5649fF51123D534044aA7E6cBc8762698Ffed713
PERMIT2_ADDRESS=   # leave empty → address(0). Do not enable Permit2.
```

The script allowlists `ROUTER_ADDRESS` and marks `TOKEN_ADDRESS` EIP-2612. If you also need gMOCK `0x30006e29a23c713070136F56db1BDf2A8B82B318`, owner-call `setEip2612Token` after deploy (Spencer).

## After a successful broadcast (Spencer)

1. Confirm `permit2Enabled() == false`, `owner()` is the intended owner, `relayers(RELAYER_ADDRESS) == true`.
2. Update README Live table, `relayer/.env.example`, `render.yaml` swap address, wallet `VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA`.
3. Point `GAS_RESCUE_SWAP_ADDRESS` at the new swap and, if desired, broadcast `DeployGasRescueLens` (see [BUILDATHON_PROGRESS.md](BUILDATHON_PROGRESS.md)).
4. Re-run `InspectGasRescueSwap` and the Arb fork tests against the new address (update constants in `src/GasRescueLens.sol` / `test/fork/ArbSepoliaLive.t.sol` in a follow-up PR).

## Do not

- Broadcast from an agent or CI
- Enable Permit2
- Deploy or advertise `StrandedRegistry` as the judged product
- Use mainnet RPC, mainnet WETH, or any chain other than 421614 / 84532
