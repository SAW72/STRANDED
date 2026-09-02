# GasRescueSwap Design Doc

**Status:** Documents the approved freeze / merged impl; CEO sign-off of this write-up.  
**Product:** `GasRescueSwap` (testnet only: Base Sepolia 84532, Arb Sepolia 421614).  
**Blocker:** GitHub issue #4.  
**Auditor gate:** docs/AUDITOR.md.  
**Code:** `src/GasRescueSwap.sol` (already implemented and tested; this doc freezes the intent).

---

## 1. Problem (layman's terms)

A user holds a token they cannot sell or move because they have **zero native ETH** for gas. They are stranded.

GasRescueSwap lets them sign **once** (off-chain). A helper (the relayer) pays the gas. A small slice of the token is swapped into native gas. The rest of the token is sent to the user's chosen wallet on the same chain. Everything happens in **one atomic transaction**: if any step fails, nothing moves.

No bridges in v1. No mainnet. No token launch.

---

## 2. Actors

| Actor | Role |
| --- | --- | 
| **User** | Holds stranded ERC-20, has zero native. Signs the Order + gasless auth. Never pays gas. |
| **Relayer** | Hot key that pays gas and submits the tx. Allowlisted; must not be the owner. |
| **Owner** | Deployer / admin. Sets allowlists, pause, Permit2. Cannot be a relayer. |
| **Router** | Allowlisted DEX router (e.g. Uniswap). Called with exact signed calldata. |
| **feeTo** | Receives the in-token fee. |
| **to** | Receives the remainder ERC-20 (same-chain move-out). |
| **nativeTo** | Receives the native gas from this job. |

`msg.sender` is **never** treated as the user, fee, remainder, or native recipient.

---

## 3. The Order (EIP-712)

Domain: `name = StewardGasRescue`, `version = 1`, `chainId`, `verifyingContract`.

```
Order(
  address user,
  address tokenIn,
  uint256 amountIn,
  uint256 feeAmount,
  address feeTo,
  uint256 amountSwap,
  uint256 minAmountOut,
  address to,
  address nativeTo,
  address router,
  bytes32 pathHash,
  uint256 chainId,
  uint256 deadline,
  uint256 nonce
)
```

- `amountSwap + feeAmount <= amountIn` (overflow-safe).
- `pathHash = keccak256(swapData)` — the router calldata is bound into the signature.
- `chainId` must equal `block.chainid`.
- `nonce` is per-user and consumed only on success.

---

## 4. Auth paths (gasless)

1. **EIP-2612 permit** — token must be owner-allowlisted via `setEip2612Token`. User signs a standard permit; contract pulls exactly `amountIn`.
2. **Permit2** — gated off by default (`setPermit2`). When enabled, uses `permitWitnessTransferFrom` with the Order struct hash as the witness. Fail closed if disabled.
3. **Non-permit tokens** — no "just transferFrom" path. If the token is not EIP-2612-allowlisted and Permit2 is disabled, the call reverts `NoGaslessAuth`. This is intentional: no user signature on-chain means no rescue.

---

## 5. Execution sequence (atomic)

Modifiers: `nonReentrant`, `whenNotPaused`, `onlyRelayer`.

1. **View-only preflight** (no nonce write): testnet + matching chainId; nonzero addresses; amount bounds; deadline; token + router allowlists; unused nonce; `keccak256(swapData) == pathHash`; recover signer == `order.user`; `balanceOf(user) >= amountIn`.
2. **Gasless-auth gate** — else `NoGaslessAuth` (still no nonce write).
3. **Consume nonce** — `usedNonces[user][nonce] = true`.
4. **Sweep pre-existing dust** — any ETH or WETH sitting on the contract from prior donations is sent to the owner *before* the pull, so a donation cannot DoS rescues via `DustRemaining`. Sweep runs in both `rescueWithPermit` and `rescueWithPermit2` entrypoints, before `permit`/`permitWitnessTransferFrom`. Because the sweep is pre-pull, any WETH present is a donation — never the user's just-pulled `amountIn` — so WETH is always swept, including when `tokenIn == WETH`. ETH is **wrapped to WETH** (`weth.deposit{value: ethDust}()`) and transferred to owner via `IERC20.safeTransfer` (option B). This keeps the strict end-of-tx zero invariant, kills owner-receive grief (ERC-20 transfers do not depend on a receive hook), and avoids stranded credits on ownership transfer.
5. **Pull** — permit or Permit2. Exact balance delta required (`FoTOrBalanceMismatch` on fee-on-transfer).
6. **Settle (Appendix A):**
   - skim `feeAmount` → `feeTo`,
   - send `remainder = amountIn - feeAmount - amountSwap` → `to`,
   - require contract holds **exactly** `amountSwap` (leftover tokenIn reverts; never forwarded to `to`),
   - call router with `swapData`; unwrap **this job's** WETH delta; credit **this job's** native delta to `nativeTo` if `>= minAmountOut`,
   - end-of-tx: `tokenIn`, WETH, and ETH on the contract must all be zero (`DustRemaining` otherwise).
7. Emit `Rescued`.

Any revert rolls back the nonce write. Bad signatures, underfunded, path mismatch, slippage — none burn the nonce.

---

## 6. Security invariants (locked)

- Fail closed: no mainnet path, no unallowlisted token/router, no disabled Permit2, no non-permit fallback.
- Job-only native credit: donated ETH/WETH on the contract is **wrapped/swept to the owner before the pull**, never to `nativeTo`. `nativeTo` receives only this job's earned native.
- Exact `amountSwap` consumption: partial fills revert; leftovers never reach `to`.
- Owner ≠ relayer hot key.
- Non-proxy, `ReentrancyGuard`, owner-only pause + allowlists.
- End-of-tx dust must be zero: `tokenIn`, WETH, and ETH balances on the contract are all zero after every rescue.
- Owner-receive grief: ETH donations are wrapped to WETH and transferred to owner (option B), so a non-receiving owner cannot revert the rescue. WETH is transferred directly. No pending balance, no skim function, no stranded credits on ownership transfer.

---

## 7. Relayer economics

- Relayer pays gas in native. Compensation = `feeAmount` (in token) + any spread the relayer captures on the swap.
- Worst case: swap returns less than `minAmountOut` → whole tx reverts, relayer loses only gas. No partial fill, no stuck funds.
- Kill switch: `pause()` (owner-only). Paused rescues revert.
- Relayer is a hot key; owner key stays cold.

---

## 8. Non-permit tokens (LOCKED for v1: B)

**LOCKED for v1: B.** Non-permit tokens are fail-closed. If a token does not support EIP-2612 permits and Permit2 is disabled, the rescue reverts with `NoGaslessAuth`. No rescue path, no partial execution, no trusted forwarder in v1.

Option A (owner allowlists a trusted forwarder with a `rescueWithTransfer` path) is deferred to v2 after the core is audited and live. This keeps the audit surface small and matches the fail-closed posture everywhere else in the contract.

---

## 9. Out of scope (v1)

- Bridge / cross-chain move-out.
- Wallet UX / frontend.
- Relayer TypeScript service (separate repo).
- Mainnet deployment, token launch, paid firm audit packaging.

---

## 10. Gates before mainnet

1. This design doc signed off by CEO.
2. Auditor bot traces it + `GasRescueSwap.sol` → severity-ranked findings (docs/AUDITOR.md).
3. Residual Medium fixed: `DustRemaining` + donation DoS (issue #6).
4. Full E2E rescue on Arb Sepolia with a real stranded token.
5. Human firm audit (Trail of Bits / OpenZeppelin / equivalent) signs off.
6. Relayer service + wallet UX built and tested.

No mainnet work starts until all six pass.

---

## Sign-off

| Role | Name | Date | Signature |
| --- | --- | --- | --- |
| CEO |  |  |  |
| Auditor (bot) |  |  |  |
| Builder |  |  |  |
