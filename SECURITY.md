# Security summary

**Status:** testnet only. This is an operator snapshot of `GasRescueSwap` on `main`, not a third-party audit and not a mainnet go.

**Reviewed:** 2026-09-27. **HEAD:** `7ac55f8`.

Networks: Base Sepolia (84532) and Arbitrum Sepolia (421614). The product contract is `src/GasRescueSwap.sol`. `src/GasRescue.sol` is a harness. Do not deploy the harness as the rescue.

The long write-up is [docs/AUDIT-FINDINGS.md](docs/AUDIT-FINDINGS.md) (2026-09-02, then-HEAD `c2e4a17`). Finding 1 in that file is stale. This page is the current snapshot.

## What holds

- Both rescue entrypoints are `onlyRelayer`, `nonReentrant`, and `whenNotPaused`. Permit2 stays off until the owner enables it, and the constructor accepts only the zero address or canonical Uniswap Permit2.
- `_checkOrder` reverts unless the chain is one of the two testnets. The EIP-712 order binds `nativeTo`. The nonce is written only after the view preflight, so a reverted rescue does not burn it.
- Before the pull, `_sweepDust` sends donated ETH (wrapped to WETH), donated WETH, and donated `tokenIn` to the owner. The user's tokens are not in the contract yet, so they are not swept.
- The user's token balance must fall by exactly `amountIn`. A fee-on-transfer token or an extra drain reverts. The router must consume exactly `amountSwap`. This job's native delta must be at least `minAmountOut`. At the end of the transaction the contract holds no `tokenIn`, WETH, or ETH.
- `renounceOwnership` is disabled. The owner and the relayer must be different addresses.

## Stale finding

[docs/AUDIT-FINDINGS.md](docs/AUDIT-FINDINGS.md) Finding 1 said a 1-wei `tokenIn` donation permanently halted rescues of that token, because `_sweepDust` did not move `tokenIn`. On this HEAD `_sweepDust` does move it, and both entrypoints call that sweep before the pull. Do not treat Finding 1 as open.

## Live demo router (Arb Sepolia)

On 2026-10-01 the owner migrated the Arb Sepolia demo router. The judged rescue is still `GasRescueSwap` `0x65e712222745A8FCCbF038A90Fa75caB0867993D`.

Before that migration, the allowlisted demo router was the open `MockSwapRouter` at retired open router `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` (delisted Oct 1, 2026). It held **0.0195 ETH** and `payAmount()` was **0.0001 ETH**. `setPayAmount` had no access control. `swapExact` paid that amount even when `amountIn` was 0, so anyone could take the inventory.

The inventory now sits on `LockedDemoSwapRouter` `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` (0.0195 ETH). `allowedRouters` is true for that router and false for the retired open router, which holds 0 ETH. Only the rescue contract may call `swapExact`. The call pulls the tokens (short deliveries revert). ETH paid back to the rescue is `amountIn * rate / denominator`, capped by `maxPayout`. Settings and `withdrawEth` are owner-only. `test_nonOwnerCannotDrain` covers a stranger calling the setters, `withdrawEth`, and `swapExact`.

The open deployment cannot be upgraded in place; it was delisted. Do not broadcast `script/DeployLockedDemoSwapRouter.s.sol` again: the migration already ran, and a second broadcast deploys another router. Source `MockSwapRouter` setters are `onlyOwner`, and a zero-token swap reverts, so a future mock deploy is not open the same way. The live Render `ROUTER_ADDRESS` flip is a separate step awaiting Spencer's OK.

## Still open

- Permit2 unit tests use a mock that accepts any signature. They do not prove a wallet digest would verify on canonical Permit2. The production witness type string was checked by hand; a fork test is still the gap (AUDIT-FINDINGS Finding 2).
- The owner can allowlist a hostile token. The contract says not to. A malicious allowlisted token can still misbehave inside its own `permit` or balance logic beyond the exact-drop check.
- The README product sequence still omits the pre-pull sweep and still says the contract never sweeps `address(this).balance`. Donations are swept to the owner. They are not credited to `nativeTo`. [docs/DESIGN.md](docs/DESIGN.md) matches the code. The README wording does not.

## Not claimed

No mainnet path. No outside firm audit. A firm audit is still required before mainnet.
