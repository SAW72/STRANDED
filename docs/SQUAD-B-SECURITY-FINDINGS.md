# Squad B security findings

**Repo:** SAW72/STRANDED only. **Branch:** `cursor/squad-b-security-stack-d899`.
**Tooling:** Slither 0.11.6 (Trail of Bits, free), solc 0.8.24 via Foundry, `forge test` fuzz runs 256.
**Not done:** no deploy, no broadcast, no mainnet, no live-testnet change, no monitoring or auto-pause.

## What was already in the code

`GasRescue`, `GasRescueSwap`, and `StrandedRegistry` already inherit OpenZeppelin `Ownable2Step`, `Pausable`, and `ReentrancyGuard`. `renounceOwnership` is disabled on all three. Privileged setters (relayer, token, router, EIP-2612, Permit2 enable, finder fee, min bond, pause, unpause) were already `onlyOwner`. Rescue entrypoints were already `nonReentrant whenNotPaused onlyRelayer`.

`Ownable2Step` matches the existing owner pattern, so this change does not add `AccessControl` or a second pause key. The pause authority is the owner passed to each constructor as `initialOwner`. That address is not hardcoded and is not an agent key. A mainnet owner must be a multisig or timelock; this branch does not deploy.

The live Arb/Base Sepolia contracts are untouched. `GasRescueLens.LIVE_OWNER` (`0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`) is the documented Steward owner of those deployments. Pausing them is an owner transaction on the **already deployed** bytecode, which this PR does not replace.

## What this change adds

| Contract | Change |
| --- | --- |
| `StrandedRegistry` | `whenNotPaused` on `depositBond`, `withdrawBond`, `reclaimExpired`, and on value-bearing `receive`. `claimFind` rejects a zero bounty recipient before the ETH call. |
| `GasRescueSwap` | Value-bearing `receive` reverts while paused. Zero-value `receive` stays a no-op and does not read storage, so it cannot break the WETH9 2300-gas unwrap. |
| `GasRescue` | No behavior change. It already had the stack and it neither holds nor pays ETH. |
| `GasRescueLens` | Not modified. |

`setFinderFeeBps`, `setMinBond`, and the rescue allowlist setters stay callable while paused so the owner can tighten policy before unpausing. They do not move ETH.

`reclaimExpired` used to succeed while paused (`test_M4_reclaimExpired_worksWhilePaused`). It now reverts `EnforcedPause`. Posters cannot pull a bond out during the kill switch. The owner must `unpause` before withdraw or reclaim.

## GasRescueLens

Left unchanged. It is a view helper: one immutable `swap` pointer, no admin functions, no `receive`, no ETH or token balance, no call that sends value. Permit2 is observed and never enabled. Slither's low `missing-zero-check` on `rescueReceiptOrMissing(user, …)` is a false positive: `user == address(0)` is a valid empty-receipt probe, and rejecting it would change a read-only API.

## Slither

Command (repo root, after the patch):

```bash
slither . --filter-paths "lib/|test/|script/" --exclude-dependencies --fail-none
```

Slither 0.11.6 analyzed 50 in-`src` contracts (production, demo helpers, and mocks) with 102 detectors. **43 results.** No detector was disabled. One low was cleared by a code change (44 results before the zero-address check). Nothing else in production was a defect to patch; the rest are false positives or out-of-scope mocks.

### Fixed

`missing-zero-check` on `StrandedRegistry.claimFind` (bounty call to `rescuer`). `rescuer` is `msg.sender`, and the receipt gate already reverts `InvalidRescueProof` when `receiptRelayer == address(0)`. Slither still flagged the later `.call` because that check is on a different variable. The payout now reverts `ZeroAddress` if `rescuer` is zero. Real callers are unchanged: a zero `msg.sender` never gets past the receipt check either.

### Production findings left in place (false positives)

**`arbitrary-send-erc20` (High) — `GasRescue._pullAndSettle`, `GasRescueSwap._pullSwapAndSettle`.**
`transferFrom` uses `order.user`, not `msg.sender`. That is the product: an allowlisted relayer pulls a wallet that signed the EIP-712 order and the permit. The signer is recovered before the pull, the nonce is consumed inside `nonReentrant`, and the user's balance must fall by exactly the signed amount. Changing `from` to `msg.sender` would pay the relayer. Not a bug.

**`arbitrary-send-eth` (High) — `GasRescueSwap._settleAndSwap` to `order.nativeTo`.**
`nativeTo` is a signed order field. The relayer cannot redirect it. `nativeOut` is this job's ETH delta after the pre-pull dust sweep, and it must be at least the signed `minAmountOut`. The contract then requires a zero ETH balance, so the call sends that delta and nothing else.

**`reentrancy-balance` (High) — balance snapshot before `transferFrom` / Permit2, compared after.**
The snapshot is the check, not a stale read. The post-call balance is loaded again. A token that donates or skims during the callback fails `FoTOrBalanceMismatch` and the whole transaction rolls back. Both rescue entrypoints are `nonReentrant`, so the callback cannot re-enter a rescue. Same pattern on `LockedDemoSwapRouter.swapExact` (also `nonReentrant`); that router was not edited.

**`timestamp` (Low) — order and find deadlines.**
`block.timestamp` is compared to a user- or poster-supplied deadline. It is not used as a random source. Removing it would drop expiry.

### Out of scope for a code change

**`incorrect-equality` (Medium) — `LockedDemoSwapRouter.sweepToken` `bal == 0`.**
Demo helper, not a production rescue contract. `bal == 0` means "nothing to sweep", then the function reverts. A donation makes the sweep succeed, which is what the owner function is for. Not the strict-equality balance invariant Slither is warning about. The router was not given `Pausable`: that would expand the demo surface, and it would not change the live router at `0xFE22…f7fc`.

**Mocks (`EvilDifferentTokenPermit2`, `MockPermit2`, `MockSwapRouter`, `SiphonEip2612Token`).**
`arbitrary-send-erc20`, missing events, and missing zero checks are intentional test doubles (hostile Permit2, reentering router, siphon token). Not production.

**Informational (not patched).**
`low-level-calls` are checked (`ok` / `sent` required). `DOMAIN_SEPARATOR` / `ORDER_TYPEHASH` keep the EIP-712 names Slither's mixedCase rule dislikes. `GasRescueLens` uses a short assembly word only to read a revert selector. `MockWETH` does not declare `IWETH`. Cyclomatic complexity on the rescue settle path is the audited sequence, not a refactor target.

## ETH outflow inventory

### `GasRescue`

Holds no ETH and has no `receive` and no value call. ERC-20 only: the relayer's `rescueWithPermit` sends `feeAmount` of `order.token` to the signed `feeTo` and the remainder to `order.user`. Limit: `0 < feeAmount < amount`, token allowlisted, nonce unused, contract not paused.

### `GasRescueSwap` (holds ETH only inside a rescue, must end at 0)

| Outflow | Who triggers it | Limit |
| --- | --- | --- |
| ETH to `order.nativeTo` via `call` in `_settleAndSwap` | Allowlisted relayer, not the owner, contract not paused, valid user signature, Base Sepolia or Arb Sepolia | `nativeOut` = this job's ETH increase (including WETH unwrapped in the job). Must be `>= order.minAmountOut` (`minAmountOut > 0`). Pre-existing ETH is not included; it was wrap-swept first. End-of-tx ETH balance must be 0. |
| Pre-existing ETH, wrapped to WETH, then WETH to `owner()` in `_sweepDust` | Same relayer rescue, before the user pull | Entire ETH balance at sweep time. Not a separate owner withdraw. Recipient is the owner, not `nativeTo`. |
| Pre-existing WETH to `owner()` | Same sweep | Entire WETH balance. |
| Pre-existing `tokenIn` to `owner()` when `tokenIn != WETH` | Same sweep | Entire `tokenIn` balance. User funds are not in the contract yet. |
| `feeAmount` of `tokenIn` to signed `feeTo` | Same rescue | `feeAmount <= amountIn - amountSwap`. Zero is allowed and skips the transfer. |
| Remainder `tokenIn` to signed `to` | Same rescue | `amountIn - feeAmount - amountSwap`. Zero skips the transfer. |
| `amountSwap` of `tokenIn` to the signed allowlisted router (`forceApprove` then `call`) | Same rescue | Exactly `amountSwap`. Approval is reset to 0. Router must consume all of it. |

There is no owner function that withdraws ETH. `setPermit2(address,bool)` always reverts `Permit2Immutable`.

`receive` accepts ETH only while unpaused (and only with a full-gas call). While paused, a value-bearing `receive` reverts, including a direct `WETH.withdraw` into this contract. During an unpaused rescue the pause slot is already warm, so the WETH9 2300-gas unwrap still succeeds (`test_swap_directWethWithdraw_fitsUnpausedReceive` and `test_happyPath_wethUnwrap`).

### `StrandedRegistry` (native bonds only; no user tokens)

| Outflow | Who triggers it | Limit |
| --- | --- | --- |
| `withdrawBond(amount)` to `msg.sender` | That poster, contract not paused | `amount <= availableBond(poster)` which is `posterBond - lockedBond`. Cannot spend a find's locked bond. `amount == 0` transfers nothing. |
| `claimFind` bounty to `msg.sender` | The relayer on the matching `GasRescueSwap` receipt, contract not paused, same chain, before the find deadline | `bounty` wei from **this find's** `findBond` only. `bounty` was capped by the bond at register. Zero bounty skips the call. Other finds and unlocked deposits stay. |
| `claimFind` refund to `find.poster` | Same claim | `findBond - bounty` of that find. |
| `reclaimExpired` to `find.poster` | The poster, after `deadline`, contract not paused, same chain, not already claimed | The full remaining `findBond` for that find. Marks the find claimed so a late receipt cannot pay it. |

The owner cannot withdraw bonds. `setFinderFeeBps` only changes an off-chain token-unit figure on `FindClaimed` (max 10%). It never sends ETH.

Inflows: `depositBond` and value-bearing `receive` credit `posterBond[msg.sender]`. Both revert while paused. `receive` is intentionally not `nonReentrant`, so a refund recipient that forwards ETH back cannot brick `claimFind` / `withdrawBond`.

### `LockedDemoSwapRouter` (demo, not modified, not redeployed)

| Outflow | Who triggers it | Limit |
| --- | --- | --- |
| `swapExact` ETH back to `msg.sender` | Only the configured `rescue` contract | `quote(amountIn) = min(amountIn * rate / denominator, maxPayout)`, and `amountIn > 0`. The third argument is not the payee. |
| `withdrawEth(to, amount)` | Owner | `0 < amount <= address(this).balance`, `to != 0`. |
| `sweepToken` | Owner | Entire token balance to `to`. |

The live router inventory (0.0195 ETH at `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` as of the 2026-10-01 notes in `SECURITY.md`) is unchanged by this branch.

## Kill-switch runbook

Pause authority is the `Ownable2Step` owner of **each** contract. There is no shared pause flag and no agent key. `renounceOwnership` reverts. Ownership moves only through `transferOwnership` then `acceptOwnership` on that contract.

1. From the owner account, call `pause()` on each deployed instance that must stop: `GasRescueSwap` (the product), `StrandedRegistry` if that deployment exists, and the `GasRescue` harness if one is in use. One transaction per contract.
2. While paused, rescues, registry registration, claims, bond deposits, bond withdraws, expired reclaims, and value-bearing `receive` revert `EnforcedPause`. Allowlist and fee setters still work. Use them to delist a token, router, or relayer, or to turn `permit2Enabled` off, before unpausing.
3. Confirm with `paused() == true`. `GasRescueLens.status().paused` reads the swap it was constructed against.
4. To resume, the same owner calls `unpause()` on that contract. A second `pause` while paused reverts `EnforcedPause`. A second `unpause` while running reverts `ExpectedPause`.
5. This repo does not watch balances or pause automatically. Pause is a manual owner transaction.

New deploys must pass Spencer's owner (or a timelock/multisig that owner controls) as `initialOwner`. Do not pass an agent hot key.
