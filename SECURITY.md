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

The open deployment cannot be upgraded in place; it was delisted. Do not broadcast `script/DeployLockedDemoSwapRouter.s.sol` again: the migration already ran, and a second broadcast deploys another router. Source `MockSwapRouter` setters are `onlyOwner`, and a zero-token swap reverts, so a future mock deploy is not open the same way. The live Render `ROUTER_ADDRESS` on `stranded-relayer-arb` has been `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` since Oct 1, 2026, 1:27 PM ET (Relayer Backend deploy), and quotes return that router.

## H1 — public GRTT mint

Live GRTT `0x5649fF51123D534044aA7E6cBc8762698Ffed713` and gMOCK `0x30006e29a23c713070136F56db1BDf2A8B82B318` both contain `mint(address,uint256)` and do not contain `owner()`, `setMinter`, or `setMintEnabled` (runtime bytecode, 2026-10-01). Anyone can mint. The relayer pays gas, so a wallet with 0 ETH can mint and call `rescueWithPermit`.

`LockedDemoSwapRouter` `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` holds **0.0195 ETH**. `maxPayout` is **0.001 ETH**. `quote(1 ether)` is 0.0005 ETH and `quote(0.2 ether)` / `payAmount()` is 0.0001 ETH. Nineteen max-payout rescues leave 0.0005 ETH. Relayer limits on `main` (1 success per wallet and 3 per IP per 4 hours) reset on every deploy. Seven IPs can empty a full inventory inside one window.

### Rejected: per-user cap on the router's third argument (M-1)

`swapExact(tokenIn, amountIn, nativeTo)`'s third argument cannot be a per-user key. `GasRescueSwap` forwards `swapData` after `keccak256(swapData) == order.pathHash`. It does not require that word to equal signed `order.user` or signed `order.nativeTo`. The signer can pass a fresh address on every order. The ETH payout follows `order.nativeTo`, not the router argument. `test_thirdArgCapIsBypassableByRotatingTheArgument` takes two max payouts from one 0-ETH signer by rotating that argument. A cap keyed on it is bypassable. Rejected.

### Auditor options

**(1) Restrict mint on both GRTT and gMOCK.** Neither live token has a mint gate. This cannot be done with an owner call on the contracts that are already deployed. A new token is required, then `setEip2612Token(new, true)` and `setTokenAllowed(false)` on both open tokens (that delist also clears `eip2612Tokens` on the live rescue).

- A new token with no public mint closes the drain. Fresh addresses cannot create supply. The constructor funds the demo wallet and the Steward wallet. This draft uses that token with a fixed supply and no owner mint.
- A capped one-time-per-address faucet does not close it. Each fresh address mints once and takes one payout. Rejected.

**(2) Global router payout rate limit (max ETH per hour, not per user).** The live router has `setMaxPayout`, `setRate`, `withdrawEth`, and `setRescue`. It has no hourly accumulator (`setMaxEthPerHour` / `maxEthPerHour` are absent). `setMaxPayout` is a per-swap ceiling, so 19 swaps still empty the inventory. This needs a new router, `setRouterAllowed` on and off, and `withdrawEth` of the 0.0195 ETH. That router deploy is a separate PR. Do not edit `script/DeployLockedDemoSwapRouter.s.sol` here. A cap of 0.001 ETH per hour still empties 0.0195 ETH in about a day. It slows the drain. It does not close it.

`withdrawEth` or `setMaxPayout(0)` on the live router is a one-transaction stopgap. The next top-up or the next non-zero cap is drainable again. The live judge submit fails until the owner restores a payout.

### Chosen fix

Fixed supply, not an ongoing owner mint, and not the faucet or the hourly router cap. The draft does not redeploy `GasRescueSwap` or the router. `src/GatedDemoToken.sol` is EIP-2612 with no `mint`, no owner, and no function that creates more supply. Its ERC20 name and permit domain are "Stranded Demo Token" and its symbol is SDEMO. Those strings are immutable once deployed. The constructor creates the only 20 SDEMO: 2 to `0x5BFd…BA37` and 18 to `0x3046…bA9D`. `script/MigrateH1GatedDemoToken.s.sol` is simulate-only and keyless: `vm.startBroadcast()` with `--sender` / `--account`. It reverts if the sender is Foundry's default `0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38`. Spencer (`0x3046…bA9D`) signs with `--account` and `--sender`, and with `--slow`. A fresh run is up to four transactions: deploy the token, then `setEip2612Token` / the two `setTokenAllowed(false)` calls using the address `new` returned. If a run stops halfway, set `EXISTING_TOKEN` to the printed address and run again with `--broadcast --slow`. That path does not deploy a second token, and it skips a setter that is already applied. If the constructor balances have already been transferred, the resume still accepts the token: supply cannot be recreated, and the script does not move balances. No key is stored in the repo. Do not pass `--broadcast` from an agent. Do not hardcode a nonce-predicted address.

`ArbSepoliaDemoPath.demoToken()` is the one demo-token read. Unset, it is live GRTT, so `HackQuestStatus` stays `ready: true` for `0x5BFd…BA37` before those transactions. After Spencer signs, set one line `DEMO_TOKEN=<deployed>` on the relayer (`DEMO_TOKEN` wins over `TOKEN_ADDRESS`). `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` is a Render env change on the static site `stranded` plus a rebuild. That keeps the same check `ready: true` on the new token. `GasRescueLens.LIVE_ARB_GRTT` stays the live GRTT constant.

### SDEMO distribution

The README disclosure matches the contract: fixed 20 SDEMO, created once, with no `mint`. Ownable was dropped because `mint` was the only privileged function. Judges receive 2 SDEMO by transfer from the Steward wallet.

- No faucet and no liquidity pool.
- Log every transfer (date, recipient, amount, tx hash) in [docs/SDEMO_DISTRIBUTION_LOG.md](docs/SDEMO_DISTRIBUTION_LOG.md).

`0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` is Spencer's demo/QA EOA. It was allowlisted as a relayer in the past. On 2026-10-01 `relayers(address)` on `GasRescueSwap` `0x65e7…993D` returned false for it. The live relayer hot key is `0x8240…9AF6`. A wallet that does not receive a transfer gets nothing. ETH out is at most SDEMO `totalSupply()` times 0.0005 ETH, so 2 SDEMO = 0.001 ETH and 20 SDEMO = 0.01 ETH, which is 51% of the router's 0.0195 ETH inventory. Remainders are returned and can be swapped again, so the ceiling is the full supply times the rate, not a count of demo slices.

### Tokenomics conditions through judging

The 0.01 ETH bound holds only while these stay true. A change needs a new Tokenomics sign-off.

1. GRTT and gMOCK are delisted on-chain and that delist is confirmed.
2. The router rate stays 0.0005 ETH per SDEMO and `maxPayout` stays 0.001 ETH. Do not call `setRate` or `setMaxPayout`.
3. Router inventory stays at least 0.01 ETH. Do not withdraw during judging.
4. Do not call `sweepToken` on SDEMO on the router during judging. The 0.01 ETH ceiling assumes router-held SDEMO is never swept and sent out again.

Allowlist scan (`cast logs` of `TokenAllowed` and `Eip2612TokenAllowed` from block 300000000, before this rescue had code, through latest, plus `cast call` on `allowedTokens` / `eip2612Tokens`): only gMOCK (allowed at block 305436708, tx `0x99ba7a0f…4b8ba6`) and GRTT (allowed at block 305485600, tx `0x5773aed6…444eea`). Both flags are true for those two. WETH `0x980B…17c73` is false. No third token, so no extra delist. The Steward wallet holds 18 of the fixed 20 SDEMO and can transfer them; `withdrawEth` on the router is a separate owner power. The open GRTT contract stays mintable forever. It cannot pay out once it is delisted. Do not edit `render.yaml` in the fix PR.

## Still open

- Permit2 unit tests use a mock that accepts any signature. They do not prove a wallet digest would verify on canonical Permit2. The production witness type string was checked by hand; a fork test is still the gap (AUDIT-FINDINGS Finding 2).
- The owner can allowlist a hostile token. The contract says not to. A malicious allowlisted token can still misbehave inside its own `permit` or balance logic beyond the exact-drop check.
- The README product sequence still omits the pre-pull sweep and still says the contract never sweeps `address(this).balance`. Donations are swept to the owner. They are not credited to `nativeTo`. [docs/DESIGN.md](docs/DESIGN.md) matches the code. The README wording does not.

## Not claimed

No mainnet path. No outside firm audit. A firm audit is still required before mainnet.
