# Security Audit: GasRescueSwap (Scout #1)

**Auditor:** Internal auditor bot (docs/AUDITOR.md) — not a human firm.  
**Scope:** `src/GasRescueSwap.sol` + interfaces, deploy/rescue scripts, tests, mocks, `docs/DESIGN.md`, `README.md`. Harness `src/GasRescue.sol` reviewed only for deploy confusion.  
**HEAD:** `main` @ `c2e4a1788c3535e1fc68aca8578f40444d2f35d4` (PR #7 merged: vendored libs + wrap-ETH tests; wrap-ETH dust sweep already in `GasRescueSwap.sol`).  
**Date:** 2026-09-02  
**Method:** Full source trace of input → auth → nonce → sweep → pull → settle → swap → native credit → end-of-tx zeros. DESIGN.md compared to code line by line. Permit2 `witnessTypeString` checked against Uniswap Permit2 `PermitHash.sol` stub + EIP-712 nested-struct ordering.

---

### Summary

**Overall risk: moderate residual (one Medium), no Critical or High.**  
The product contract matches the frozen design. Auth is fail-closed, EIP-712/`nativeTo` are frozen correctly, mainnet execution is blocked, Permit2 witness type string **would bind on real Permit2**, issue #6’s ETH/WETH `DustRemaining` donation DoS **is fixed** on this HEAD, and leftover `tokenIn` is never forwarded to `to`.

One exploitable Medium remains: a permissionless `tokenIn` dust donation bricks all future rescues of that token via `SwapInputNotConsumed`, with no owner recover. That is a sibling of issue #6, not the ETH/WETH path issue #6 described. No funds are stolen; user balances stay in the user’s wallet.

---

## DESIGN.md vs `GasRescueSwap.sol`

| Design claim | Code | Match? |
| --- | --- | --- |
| Domain `StewardGasRescue` / `1` | `EIP712("StewardGasRescue", "1")` at `src/GasRescueSwap.sol:95` | Yes |
| Order typehash frozen; field is `nativeTo` not `safeRecipient` | `ORDER_TYPEHASH` at `:27-29`; struct in `src/interfaces/IGasRescueSwap.sol:10-25` | Yes |
| Testnet-only 84532 / 421614 | `_isAllowedTestnet` `:313-317`; `_checkOrder` `:292`; deploy script `script/DeployGasRescueSwap.s.sol:29-33`; demo script `script/RescueSwap.s.sol:37-40` | Yes (execution + scripts; constructor does not revert on other chains — see Info) |
| EIP-2612 allowlist; Permit2 gated default off; no bare `transferFrom`; `NoGaslessAuth` fail-closed | `permit2Enabled` default false `:38`; `rescueWithPermit` `:217`; `rescueWithPermit2` `:239`; no third entrypoint | Yes |
| Permit2 `permitWitnessTransferFrom` with Order **struct hash** as witness | `:250-261` `witness = keccak256(_encodeOrder(order))` | Yes |
| Nonce after preflight + auth gate; user errors do not burn; failed execution rolls back | `_preflight` is `view` `:269`; `_consumeNonce` after auth `:218/240`; Solidity revert undoes the write | Yes |
| Sweep ETH/WETH **before** pull; wrap ETH → WETH → `safeTransfer` owner (option B); always sweep WETH including `tokenIn==WETH` | `_sweepDust` `:387-400` called at `:224` and `:246` before permit/Permit2 | Yes |
| Exact `amountSwap` consume; leftover `tokenIn` never sent to `to`; `SwapInputNotConsumed` | remainder uses signed amounts `:341-344`; exact check `:347` and post-router `:357` | Yes |
| Job-only native credit; `minAmountOut` fail-closed; end-of-tx `tokenIn`/WETH/ETH == 0 | deltas `:349-367`; `Slippage` `:367`; `DustRemaining` `:372-374` | Yes |
| Owner ≠ relayer; pause; allowlists; non-proxy; `nonReentrant`; `msg.sender` never a recipient | `onlyRelayer` `:85-88`; constructor `:97`; `setRelayer` `:112`; modifiers `:215`; recipients from `order.*` only | Yes |
| Router calldata bound by `pathHash`; router allowlisted; `forceApprove` then zero | `:275`, `:309`, `:352-355` | Yes |
| Non-permit tokens LOCKED v1 option B | `NoGaslessAuth` both entrypoints; no `rescueWithTransfer` | Yes |

**Stale docs (not a DESIGN↔code mismatch):** `README.md` product sequence (`README.md:40-52`) still omits the pre-pull sweep. `README.md:19` and `README.md:69` say the contract “never sweeps `address(this).balance`” / “donated ETH/WETH not swept” — meaning “not credited to `nativeTo`”, but the wording predates option B. `docs/DESIGN.md` matches the code.

---

### Finding 1: Pre-existing `tokenIn` dust permanently DoSes rescues of that token
- **Severity**: medium
- **Category**: Denial of Service / unexpected revert (OWASP M4 / CWE-400). Sibling of issue #6, **not** the ETH/WETH `DustRemaining` path.
- **Location**: `src/GasRescueSwap.sol:347` (pre-swap exact check); `_sweepDust` at `:387-400` only moves ETH/WETH; no `tokenIn` sweep or owner recover.
- **Description**: `_settleAndSwap` requires `token.balanceOf(address(this)) == order.amountSwap` after sending the signed `feeAmount` and `remainder`. `_sweepDust` does not touch `order.tokenIn` (unless it is WETH). Anyone can `transfer` 1 wei of an allowlisted ERC-20 to the contract at any time. The pull’s FoT check is a **delta** (`:324-326` / `:249-263`), so the donation is not rejected there. After fee + remainder, the contract holds `amountSwap + dust` and reverts `SwapInputNotConsumed`. There is no admin function to recover or burn that dust. Redeploy is the only unbrick.
- **Impact**: Permissionless, permanent halt of all rescues for that `tokenIn`. User funds are **not** locked (they never leave the user’s wallet). Attacker spends the donated dust. On testnet the cost is near zero. Same class as issue #6 (donation vs exact-balance invariant) but on `tokenIn` / `SwapInputNotConsumed` rather than ETH/WETH / `DustRemaining`.
- **Reproduction**:
  1. Allowlist token `T` via `setEip2612Token(T, true)`.
  2. Attacker: `T.transfer(address(rescue), 1)`.
  3. Relayer submits a otherwise-valid `rescueWithPermit` for `T` (happy-path amounts from `test/GasRescueSwap.t.sol:_orderFor`).
  4. Tx reverts `SwapInputNotConsumed`. `usedNonces` is rolled back.
  5. Repeat: every future `T` rescue reverts until a new contract is deployed.
  6. Contrast: `test_donatedEth_wrappedAndSweptToOwner_notNativeTo` / `test_donatedWeth_sweptToOwner_notNativeTo` pass because ETH/WETH **are** swept. There is **no** analogous tokenIn-dust test.
- **Remediation**: Sweep `order.tokenIn` to `owner()` in `_sweepDust` **before** the pull when `tokenIn != WETH` (WETH is already swept). Alternatively require `token.balanceOf(address(this)) == 0` after the ETH/WETH sweep and add an owner `rescueToken` for emergency recover. Do **not** sweep after the pull.

```solidity
// inside _sweepDust, after the WETH sweep; pass tokenIn in
if (tokenIn != address(weth)) {
    uint256 tokenDust = IERC20(tokenIn).balanceOf(address(this));
    if (tokenDust > 0) {
        IERC20(tokenIn).safeTransfer(owner(), tokenDust);
        emit DustSwept(tokenIn, tokenDust, owner());
    }
}
```

- **Status**: open (mainnet / firm-audit blocker; **not** a testnet design REJECT)

---

### Finding 2: Permit2 tests cannot prove real Permit2 binding
- **Severity**: low
- **Category**: Insufficient test coverage of cryptographic binding
- **Location**: `src/mocks/MockPermit2.sol:22-34`; tests `test/GasRescueSwap.t.sol:323-346` and `:449-469`
- **Description**: `MockPermit2.permitWitnessTransferFrom` stores `witness` / `witnessTypeString` and pulls tokens. It does **not** recover a signature, does not hash the Uniswap stub, and accepts `hex"00"`. Passing tests therefore do not prove a wallet-signed Permit2 digest would verify on canonical Permit2. Separately, the **production type string is correct** (see Extra trace 4) — this is a test-gap, not a broken typehash.
- **Impact**: A frontend that concatenates nested types in the wrong EIP-712 order, or that hashes the full Order digest instead of the struct hash, would fail against real Permit2 even though unit tests are green. No theft path in the contract itself.
- **Reproduction**: `rescueWithPermit2(..., hex"00", ...)` succeeds against `MockPermit2` after `setPermit2(mock, true)` (`test_permit2_happyPath_whenEnabled`).
- **Remediation**: Add a fork test (Base Sepolia / Arb Sepolia canonical Permit2) that signs `PermitWitnessTransferFrom` with the stub + `PERMIT2_ORDER_WITNESS_TYPE_STRING` and asserts a successful pull. Keep the mock for unit speed.
- **Status**: open (firm-audit / E2E residual; non-blocking)

---

### Finding 3: README sequence still describes the pre-sweep product
- **Severity**: informational
- **Category**: Documentation drift
- **Location**: `README.md:19`, `README.md:40-52`, `README.md:69`
- **Description**: Product sequence in the README skips the pre-pull wrap-and-sweep and still says donated ETH/WETH are “not swept”. `docs/DESIGN.md` §5.4 and `GasRescueSwap.sol` **do** sweep donations to the owner (as WETH). Operators copying the README sequence will mis-reason about dust and `nativeTo`.
- **Impact**: No on-chain bug. Confusion for relayer/wallet implementers.
- **Reproduction**: Diff README §Sequence vs DESIGN.md §5 vs `rescueWithPermit` body.
- **Remediation**: Insert DESIGN step 4 (sweep) into the README sequence; reword “never sweeps `address(this).balance`” to “never credits the full contract balance to `nativeTo`; donations are wrap-swept to owner before pull”.
- **Status**: open (non-blocking)

---

### Finding 4: Harness `GasRescue.sol` + `Rescue.s.sol` can still be mistaken for the product
- **Severity**: informational
- **Category**: Deploy / operational confusion
- **Location**: `src/GasRescue.sol:16-20` (labeled harness); `script/Deploy.s.sol`; `script/Rescue.s.sol:26-48` (no `84532/421614` require, unlike `script/RescueSwap.s.sol:37-40`)
- **Description**: The fee-skim harness remains compileable and has deploy/demo scripts. Domain name is `GasRescue` / `1`, not `StewardGasRescue`. `GasRescue` does not enforce owner ≠ relayer. `Rescue.s.sol` will broadcast against whatever `GAS_RESCUE_ADDRESS` is, on any chain the RPC is pointed at (the **current** harness bytecode then reverts `WrongChain` off Base Sepolia; an older mainnet fee-skim deployment named in issues #3/#4 would not).
- **Impact**: Wrong-contract deploy or demo against a legacy fee-skim. Not a bug in `GasRescueSwap`.
- **Reproduction**: `forge script script/Deploy.s.sol` vs `script/DeployGasRescueSwap.s.sol`; compare EIP-712 names.
- **Remediation**: Keep the harness, but add the same testnet `require` to `Rescue.s.sol`, and/or move harness scripts under `script/harness/`.
- **Status**: open (non-blocking)

---

### Finding 5: Constructor does not refuse mainnet deploy
- **Severity**: informational
- **Category**: Insecure default / defense in depth
- **Location**: `src/GasRescueSwap.sol:91-103` vs `:292` and `script/DeployGasRescueSwap.s.sol:29-33`
- **Description**: DESIGN requires mainnet blocked in **contract and deploy script**. Execution is blocked (`WrongChain` unless 84532/421614). Deployment via `new GasRescueSwap(...)` on chain 1 succeeds; the instance is inert for rescues. A non-script deployer (Remix, factory) can still place bytecode on mainnet.
- **Impact**: Dead mainnet contract / brand confusion. No working mainnet rescue path.
- **Reproduction**: `vm.chainId(1); new GasRescueSwap(owner, relayer, weth)` succeeds; `rescueWithPermit` reverts `WrongChain` (`test_wrongChain_mainnetBlocked`).
- **Remediation**: Optional: `require(_isAllowedTestnet(block.chainid))` in the constructor before any mainnet-shaped deploy. Not required for testnet.
- **Status**: open (non-blocking)

---

## Extra traces (required)

### 1. EIP-712 domain and Order typehash
**Pass.** Domain name/version set at `src/GasRescueSwap.sol:95`. Typehash string at `:27-29` equals DESIGN.md / `IGasRescueSwap.sol` / `test/GasRescueSwap.t.sol:30-32` (`test_orderTypehashMatchesApprovedString`). Recipient field is `nativeTo` everywhere; no `safeRecipient`.

### 2. Testnet-only
**Pass for execution and official scripts.** `_checkOrder` `:292` requires `block.chainid` ∈ {84532, 421614} **and** `order.chainId == block.chainid`. `DeployGasRescueSwap` and `RescueSwap.s.sol` `require` the same. Constructor does not (Finding 5). Happy path covered on both testnets (`test_happyPath_mockSwap`, `test_happyPath_arbSepolia`). Mainnet `vm.chainId(1)` reverts (`test_wrongChain_mainnetBlocked`).

### 3. Auth
**Pass.**  
- EIP-2612: `eip2612Tokens[tokenIn]` required in `rescueWithPermit` `:217`. `setEip2612Token` is owner-only and auto-allowlists the token (`:130-141`).  
- Permit2: `permit2Enabled` defaults `false` (`:38`); `setPermit2` owner-only (`:152-160`); `rescueWithPermit2` reverts `NoGaslessAuth` if disabled or `permit2 == 0` (`:239`). Deploy script default `PERMIT2_ENABLED=false`.  
- No `rescueWithTransfer` / `transferFrom`-only path.  
- Non-permit + disabled Permit2: `test_nonPermit_failClosed`, `test_permit2_disabled_failClosed`.

### 4. Permit2 witness type string vs real Permit2
**Pass — would bind on canonical Permit2.** This is **not** a High/Critical.

Uniswap Permit2 `PermitHash.sol`:

```
_PERMIT_TRANSFER_FROM_WITNESS_TYPEHASH_STUB =
  "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,"
```

`hashWithWitness` does `keccak256(abi.encodePacked(stub, witnessTypeString))`. Nested structs **must** be EIP-712-sorted (`Order` < `TokenPermissions`) and must include `TokenPermissions(address token,uint256 amount)`.

Contract constant (`src/GasRescueSwap.sol:33-34`):

```
Order witness)Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)TokenPermissions(address token,uint256 amount)
```

Concatenated encodeType:

```
PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Order witness)Order(address user,address tokenIn,...)TokenPermissions(address token,uint256 amount)
```

- Completes the stub with `Order witness)`.  
- `Order(...)` body is byte-identical to `ORDER_TYPEHASH`’s preimage.  
- `TokenPermissions(...)` matches Permit2 `_TOKEN_PERMISSIONS_TYPESTRING`.  
- Nested order is EIP-712 alphabetical (`Order` then `TokenPermissions`) — the Uniswap docs example `ExampleTrade witness)ExampleTrade(...)TokenPermissions(...)` is the same pattern.  
- Witness value is the Order **struct hash** (`keccak256(_encodeOrder(order))` at `:250`), not the full EIP-712 digest — matches DESIGN.md §4.2.

`MockPermit2` does not evaluate this hash (Finding 2). The string itself is right.

### 5. Nonce consumption
**Pass.** `_preflight` is `view` (`:269-281`): chain, addresses, amounts, deadline, allowlists, unused nonce, `pathHash`, ECDSA recover, `Underfunded`. Auth gate (`NoGaslessAuth`) is still before `_consumeNonce`. Write is `usedNonces[user][nonce] = true` (`:286`) then external calls. Any later revert (permit, FoT, slippage, `SwapInputNotConsumed`, `DustRemaining`, `SwapFailed`) rolls the mapping back. Tests: `test_underfunded_doesNotBurnNonce`, `test_wrongDomain_doesNotBurnNonce`, `test_pathMismatch_doesNotBurnNonce`, `test_invalidSignature_doesNotBurnNonce`, `test_slippage_reverts`, `test_feeOnTransfer_revertsMismatch`, `test_replay_sameOrderReverts`.

### 6. Sweep dust before pull (issue #6 ETH/WETH)
**Pass for the stated issue #6.** Both entrypoints call `_sweepDust` after nonce consume and **before** `permit` / `permitWitnessTransferFrom` (`:224`, `:246`). ETH is `weth.deposit{value: ethDust}()` then `IERC20(weth).safeTransfer(owner(), ethDust)` (`:388-392`). Remaining WETH is `safeTransfer`’d (`:395-399`). Comment and tests cover `tokenIn == WETH` (`test_wethAsTokenIn_donationSweptBeforePull`): donation cannot be mistaken for the user’s pull. Donations are **not** credited to `nativeTo` (`test_donatedEth_wrappedAndSweptToOwner_notNativeTo`, `test_donatedWeth_sweptToOwner_notNativeTo`). Owner-receive grief is killed (`test_ownerReceiveGrief_nonReceivingOwnerDoesNotBlock`). **Residual:** Finding 1 (`tokenIn` dust).

### 7. Exact `amountSwap` consume
**Pass.** Remainder is `amountIn - feeAmount - amountSwap` (`:341`), never `balance - amountSwap`. Pre-swap `:347` and post-router `:357` revert `SwapInputNotConsumed` on leftover. `test_leftoverTokenIn_afterPartialSwap_reverts` asserts `to` balance unchanged.

### 8. Job-only native, minOut, end-of-tx zeros
**Pass.** `ethBefore` / `wethBefore` snapshotted **after** sweep+pull+fee+remainder (`:349-350`). Only positive WETH delta is withdrawn (`:360-363`). `nativeOut` is ETH delta (`:365-366`). `nativeOut < minAmountOut` → `Slippage` (`:367`); `minAmountOut == 0` already `InvalidOrder` (`:302`). End-of-tx `:372-374`. Tests: `test_endOfTx_zeroAsserts_tokenInWethEth`, `test_happyPath_wethUnwrap`, `test_slippage_reverts`.

### 9. Owner ≠ relayer; pause; allowlists; non-proxy; `msg.sender`
**Pass.** Constructor `:97`, `setRelayer` `:112`, `onlyRelayer` also re-checks `msg.sender == owner()` at call time (`:87`) so a later `transferOwnership` onto a relayer disables that hot key. Pause owner-only (`:162-168`); rescues `whenNotPaused`. Tokens/routers/EIP-2612/Permit2 are owner allowlists. No `initializer` / proxy / `upgradeTo`. Recipients are `order.feeTo` / `order.to` / `order.nativeTo` / `owner()` for dust — never `msg.sender`. `msg.sender` appears only as `relayer` in `Rescued` (`:416`). Tests: `test_constructor_ownerEqualsRelayerReverts`, `test_setRelayer_ownerCannotBeRelayer`, `test_wrongRelayer_reverts`, `test_pause_blocksRescueAndOnlyOwnerCanToggle`.

### 10. Router calldata / approve
**Pass.** Empty or mismatched `swapData` → `PathMismatch` (`:275`) before nonce. Router must be `allowedRouters` (`:309`). Call is `order.router.call(swapData)` (`:353`) — target is the signed, allowlisted router; calldata is the signed hash. `forceApprove(router, amountSwap)` then `forceApprove(router, 0)` (`:352-355`). Failed router call reverts the whole tx so the temp allowance never lands. `test_routerNotAllowed_reverts`, `test_pathMismatch_doesNotBurnNonce`.

### 11. Issue #6 on this HEAD
**ETH/WETH `DustRemaining` donation DoS: fixed.** Wrap-and-sweep option B is in both entrypoints; tests cover ETH donation, WETH donation, `tokenIn==WETH`, and non-receiving owner.  
**Not fixed:** Finding 1 (`tokenIn` dust → `SwapInputNotConsumed`). Close #6 as stated (“ETH/WETH receive donation”); open a follow-up for tokenIn dust before firm audit / mainnet.

### 12. Relayer economics / revert-on-slippage
**Pass vs DESIGN.md §7.** Under `minAmountOut`, `Slippage` reverts the entire tx (nonce, permit, transfers). Relayer loses only gas. `feeAmount` goes to signed `feeTo`, not implicitly to `msg.sender`. Pause is the kill switch. Spread capture via signed `pathHash` is possible and is the documented compensation path — not a vulnerability.

### 13. `receive() payable` after sweep
**Pass for permissionless ETH.** `receive()` at `:105` is empty so WETH `withdraw` can credit this contract. ETH that arrives **before** the rescue is wrapped and swept. ETH that arrives **during** `router.call` is included in the job delta and paid to `nativeTo`. ETH that arrives in a token hook **after** sweep and **before** `ethBefore` (hostile allowlisted token) would trip `DustRemaining` — owner must not allowlist such tokens. `nativeTo` sending ETH back also trips `DustRemaining` (user-signed grief).

### 14. Permit vs Permit2 pull balance delta (FoT)
**Pass.** Permit path: `permit` then `safeTransferFrom` with delta == `amountIn` (`:324-326`). Permit2 path: `permitWitnessTransferFrom` then the same delta check (`:249-263`). Mismatch → `FoTOrBalanceMismatch`; nonce rolls back (`test_feeOnTransfer_revertsMismatch`). Rebasing / FoT tokens fail closed.

### 15. DESIGN.md stale claims vs code
**No material disagreement.** Frozen Order, `nativeTo`, option B non-permit, option B wrap-ETH sweep, job-only native, exact `amountSwap`, owner ≠ relayer all match. README is the stale document (Finding 3). DESIGN.md §10.3 still lists issue #6 as a **mainnet** gate; on this HEAD the ETH/WETH half of that gate is done.

---

## Other categories (no extra findings)

| Area | Result |
| --- | --- |
| Reentrancy | `nonReentrant` on both entrypoints. Permit / `transferFrom` / router reenter tests revert. `receive()` is empty. `nativeTo.call` cannot reenter rescues. |
| Signature replay | Per-user nonce + EIP-712 domain (`chainId`, `verifyingContract`) + `order.chainId`. Cross-order same nonce reverts (`test_replay_sameNonceDifferentFeeReverts`). OZ v5 ECDSA rejects high-`s`. |
| Access control | Owner-only setters/pause. Relayer-only rescues. `feeTo`/`to`/`nativeTo` cannot be `address(this)` (`:299-301`). |
| Cryptography | OZ EIP-712 + ECDSA. No homegrown hashing. Permit2 witness is struct hash. Test keys only (`0xA11CE` etc.). `.env` gitignored; local `.env` has empty secrets. |
| Injection | Router target is allowlisted + calldata bound by signed `pathHash`. No `delegatecall`. |
| Config | `foundry.toml`: `ffi = false`, optimizer on, solc 0.8.24. OZ 5.0.2 vendored. Permit2 default off. |
| Race / double-spend | Nonce + `nonReentrant`. Competing relayers: winner consumes nonce, loser `UsedNonce`. |
| Dependencies | OZ 5.0.2 (Ownable, Pausable, ReentrancyGuard, EIP712, ECDSA, SafeERC20). No Permit2 bytecode in-repo (interface + mock only). Firm-audit item: pin/verify canonical Permit2 addresses per testnet. |

---

### Positive Observations
- Fail-closed auth: no silent `transferFrom` rescue; disabled Permit2 reverts `NoGaslessAuth`.
- Nonce is not written until after signature, funding, path, and auth-gate checks; failures revert the write.
- `pathHash = keccak256(swapData)` binds router calldata into the user signature; relayer cannot substitute a route.
- Exact-in swap invariant + leftover-never-to-`to` closes the original leftover-forward bug.
- Job-only ETH/WETH delta; donations go to owner as WETH (option B) so a non-receiving owner cannot grief.
- Owner cannot be a relayer at construct, at `setRelayer`, or at submit time.
- Overflow-safe `amountSwap + feeAmount <= amountIn` (`:304-306`; `test_feePlusAmountSwap_overflow`).
- `forceApprove` then zero limits router allowance to one call.
- Product vs harness is labeled in `GasRescue.sol`, README, and `Deploy.s.sol` (still easy to mix up — Finding 4).
- Tests cover both testnets, WETH unwrap, replay, FoT, reentrancy, pause, owner≠relayer, wrap-sweep, and typehash freeze.

---

### Verdict
- **APPROVE**
- Justification: DESIGN.md and `GasRescueSwap.sol` agree on the frozen Order (`StewardGasRescue` / `1`, `nativeTo`), fail-closed auth, nonce timing, exact `amountSwap`, job-only native credit, wrap-ETH dust sweep, owner≠relayer, and testnet execution lock. Permit2 `PERMIT2_ORDER_WITNESS_TYPE_STRING` concatenates to a valid Uniswap Permit2 + EIP-712 typehash (Order before TokenPermissions). No Critical or High is open. The remaining Medium is griefing availability of a given token, not theft, and is the same class issue #6 already declared a firm-audit/mainnet gate rather than a Sepolia blocker.
- **Issue #6:** **Yes, close** for the stated ETH/WETH `DustRemaining` receive-donation DoS — that path is fixed and tested on this HEAD (including `tokenIn==WETH` and non-receiving owner). **Open a follow-up** for Finding 1 (`tokenIn` dust → `SwapInputNotConsumed`, no recover) and treat that follow-up as the DESIGN.md §10.3 residual Medium before firm audit / mainnet.
- **DESIGN.md for CEO sign-off on issues #3 and #4:** **Yes.** The doc freezes the implemented swap-for-gas + same-chain move-out, EIP-712 replay protection, slippage/partial-fill fail-closed, non-permit option B, and relayer economics. Sign-off table is still empty; that is the CEO step this APPROVE is meant to unblock. Update README sweep wording when convenient; it is not a design-doc defect.
- **Residual items that are firm-audit / mainnet-only (do not REJECT):** Finding 1 (tokenIn dust sweep/recover); Finding 2 (Permit2 fork test vs canonical Permit2); human firm audit (DESIGN.md §10.5); Arb Sepolia E2E with a real stranded token (DESIGN.md §10.4); router-allowlist policy (do not allowlist a general-purpose multicall without a signed-command template); Ownable 1-step / `renounceOwnership`; no ERC-1271 (EOA users only); constructor chain-id check (Finding 5); harness deploy confusion (Finding 4).

**Severity counts:** Critical 0 · High 0 · Medium 1 · Low 1 · Informational 3
