# tDEMO supply — simulate only (Base Sepolia and Arb Sepolia)

Testnet only. Never mainnet. No broadcast from this repo. No keys in git. Spencer signs from owner EOA `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` with his keystore. Arb Sepolia stays the main demo. SDEMO is unchanged.

Token name: **Stranded TEST Demo — No Value**. Symbol: **tDEMO**. Decimals: 18. Fixed supply: **1e12** tDEMO, minted once to a no-owner faucet. `drip()` pays **2 tDEMO** per wallet per **24 hours** and reverts `FaucetEmpty` when the faucet cannot pay that. No mint. No owner. No withdraw.

On-chain notice: `Testnet only (Base Sepolia 84532 or Arbitrum Sepolia 421614). No monetary value. Not for sale. Not a reward.`

Scripts: `script/TestDemoSupply.s.sol`. Every step reverts `BroadcastRefused` unless `TEST_DEMO_BROADCAST_OK=1`, and reverts `WrongChain` unless `block.chainid` is that step's chain (`84532` or `421614`). Keystore placeholder on every broadcast Spencer runs himself:

```bash
TEST_DEMO_BROADCAST_OK=1 \
forge script script/TestDemoSupply.s.sol:<Contract> \
  --rpc-url "$RPC" --chain-id <84532|421614> \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

Simulation keeps `TEST_DEMO_BROADCAST_OK=1`, omits `--broadcast` and `--account`, and passes only `--sender`. Copy addresses from receipts. Do not paste a predicted CREATE address into a later step. Fork tests revert `MissingRpc` when their RPC URL is unset. They do not skip.

Gas figures below are the script's `gasleft` deltas around each call (the inner call, not the 21,000 intrinsic). They come from the fork tests calling the same script helpers against a fork of the live chain, with no broadcast. B5's value transfers were measured after the fork dealt the owner up to exactly 0.071 ETH (0.07 ETH of transfers plus 0.001 ETH headroom). His live Base balance (about 0.0583 ETH) is short of that. The live `forge script` of B5 reverts `Underfunded` until that balance is there. A balance of exactly 0.07 ETH also reverts. `setTokenAllowed` after `setEip2612Token(true)` is a skipped branch on this bytecode (`setEip2612Token(true)` already sets `allowedTokens`), so that delta is not a transaction. A2's `setRouterAllowed` delta is the skipped `if (base)` branch.

## Who signs

| Step | Chain | Signer | Contract |
| --- | --- | --- | --- |
| B4, B1, B2, B3, B5 | Base Sepolia 84532 | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` | `GasRescueSwap` `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688` plus new contracts |
| A1, A2, A3 | Arb Sepolia 421614 | same owner | `GasRescueSwap` `0x65e712222745A8FCCbF038A90Fa75caB0867993D` and router `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` |

The relayer hot wallet `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` receives ETH in B5. It does not sign these steps.

## Base order

Run **B4, then B1, then B2, then B3, then B5**. Delist before deploy. Fund last, and only after the new token and router are allowlisted.

### B4 — delist stale allowlist

`B4_DelistStaleAllowlist`. Two calls on `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`, the same two as `docs/BASE-SEPOLIA-DELIST-STEPS.md`. `setTokenAllowed(token, false)` also sets `eip2612Tokens[token]` to false. There is no second token transaction.

1. `setTokenAllowed(0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166, false)`
   calldata `0x15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000000`
2. `setRouterAllowed(0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4, false)`
   calldata `0x6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000000`

gMOCK has public `mint`. Router `0x94cC…2bc4` is Uniswap SwapRouter02, holds 0 ETH, and is not the capped router. Do not fund it. After step 1, `allowedTokens` and `eip2612Tokens` for gMOCK are both false.

```bash
forge script script/TestDemoSupply.s.sol:B4_DelistStaleAllowlist \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain-id 84532 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

### B1 — deploy faucet and tDEMO

`B1_DeployTestDemoFaucet`. One CREATE: `TestDemoFaucet`, which creates `TestDemoToken` in its constructor and mints 1e12 tDEMO to itself.

```bash
forge script script/TestDemoSupply.s.sol:B1_DeployTestDemoFaucet \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain-id 84532 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

### B2 — deploy capped router

`B2_DeployBaseRouter`. `LockedDemoSwapRouter` with:

- `rescue` = `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`
- `rateNumerator` = `50000000000000` (5e13)
- `rateDenominator` = `1e18`
- `maxPayout` = `100000000000000` (0.0001 ETH)

`quote(2 ether)` equals `maxPayout`. The constructor sends no ETH.

```bash
forge script script/TestDemoSupply.s.sol:B2_DeployBaseRouter \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain-id 84532 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

### B3 — allowlist tDEMO and the new router

`B3_AllowlistTestDemo`. Env `TOKEN_ADDRESS` and `ROUTER_ADDRESS` are the B1 and B2 receipts.

1. `setEip2612Token(tDEMO, true)` — on this bytecode that also sets `allowedTokens`
2. `setTokenAllowed(tDEMO, true)` only if `allowedTokens` is still false
3. `setRouterAllowed(newRouter, true)`

```bash
TOKEN_ADDRESS=<B1 receipt> ROUTER_ADDRESS=<B2 receipt> \
forge script script/TestDemoSupply.s.sol:B3_AllowlistTestDemo \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain-id 84532 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

### B5 — fund

`B5_FundBaseRouter`. Plain ETH from the owner:

- `0.05 ether` to the B2 router (500 rescues at 0.0001 ETH)
- `0.02 ether` to `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6`

The script reverts `Underfunded` unless the owner holds at least 0.071 ETH: the 0.07 ETH it sends, plus 0.001 ETH headroom so those two transfers can pay gas. A balance of exactly 0.07 ETH reverts. On 2026-10-13 the owner held about 0.0583 ETH on Base Sepolia, so B5 does not simulate against live state until he collects faucet ETH. Sources are the free Base Sepolia faucets (Coinbase CDP, Alchemy, QuickNode, Superchain, Chainlink) and the Base Sepolia bridge from Ethereum Sepolia. No purchase.

```bash
ROUTER_ADDRESS=<B2 receipt> \
forge script script/TestDemoSupply.s.sol:B5_FundBaseRouter \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain-id 84532 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

## Arb A-steps

Same token and faucet. SDEMO `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C` stays allowlisted. The scripts do not call a setter on it.

### A1 — deploy

Same contract as B1, chain 421614.

```bash
forge script script/TestDemoSupply.s.sol:B1_DeployTestDemoFaucet \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

### A2 — allowlist tDEMO only

`B3_AllowlistTestDemo` on chain 421614. `ROUTER_ADDRESS` is not used. The script keeps router `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` and reverts if a different router is passed.

```bash
TOKEN_ADDRESS=<A1 receipt> \
forge script script/TestDemoSupply.s.sol:B3_AllowlistTestDemo \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

Call: `setEip2612Token(tDEMO, true)` on `0x65e712222745A8FCCbF038A90Fa75caB0867993D`. That sets `allowedTokens` and `eip2612Tokens` on the live bytecode.

### A3 — router: reuse, and lower `maxPayout` (recommended)

Checked on a fork of Arb Sepolia:

| Fact | Value |
| --- | --- |
| Router | `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` |
| Bytecode | `LockedDemoSwapRouter` (`setMaxPayout`, `quote`, `rescue`, `owner`) |
| `owner()` | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` |
| `rescue()` | `0x65e712222745A8FCCbF038A90Fa75caB0867993D` |
| `allowedRouters` | true |
| `maxPayout` | 0.001 ETH |
| `rate` | 5e14 / 1e18 (0.0005 ETH per token) |
| `payAmount()` / `quote(0.2 ether)` | 0.0001 ETH |
| `quote(2 ether)` | 0.001 ETH (already at the cap) |
| Balance | 0.0195 ETH → **19** full 0.001 ETH rescues, 0.0005 ETH left |
| `setMaxPayout` from a stranger | `OwnableUnauthorizedAccount` |
| `setMaxPayout(0.0001 ether)` from the owner | succeeds in `eth_call` / fork simulation |

**Recommendation: reuse this router. Do not deploy a second one.** Lower `maxPayout` to 0.0001 ETH.

- The call is owner-settable. One transaction. It does not move the 0.0195 ETH.
- After it, `quote(2 ether)` is 0.0001 ETH, so one faucet drip hits the cap, matching Base.
- `payAmount()` stays 0.0001 ETH, because 0.2 token already quotes exactly that.
- 0.0195 / 0.0001 = **195** rescues on the ETH already in the router.
- Funding from free faucets instead leaves the 0.001 ETH drain. Reaching 195 rescues that way needs about **0.1755 ETH** more (0.195 total). Funding is a later top-up, not the lever that bounds a drip.

SDEMO caveat: this PR does not change the SDEMO disclaimer. Today it says 2 SDEMO can draw up to 0.001 ETH and the full 20 up to 0.01 ETH, and it says not to change `setMaxPayout` during judging. A3 makes a 2-token rescue pay 0.0001 ETH (full 20 SDEMO would draw at most 0.001 ETH). The 0.2-token slice does not change. Sign A3 when that judging freeze is not in force. The SDEMO token, its allowlist, and its addresses stay as they are either way.

```bash
forge script script/TestDemoSupply.s.sol:A3_SetArbMaxPayout \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
```

Call: `setMaxPayout(100000000000000)` on `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`.

## Rescue submit access

**NOT A PROBLEM** on both swaps.

`rescueWithPermit` is `onlyRelayer` (`src/GasRescueSwap.sol` lines 101–104, applied on `rescueWithPermit` at line 253 and `rescueWithPermit2` at line 276). Fork `eth_call` with a decoded dummy order:

| Caller | Base `0x21A1…f688` | Arb `0x65e7…993D` |
| --- | --- | --- |
| `0x1111…1111` | `NotRelayer()` `0xc64891a5` | `NotRelayer()` `0xc64891a5` |
| Owner `0x3046…bA9D` | `NotRelayer()` `0xc64891a5` | `NotRelayer()` `0xc64891a5` |
| Relayer `0x8240…9AF6` | passes the gate, then `TokenNotAllowed()` on the dummy token | same |

No additional gate is proposed. The existing relayer limits (1 rescue per wallet and 3 per IP per 4 hours) still apply to the relayer process. Human Passport is not added here.

## Relayer and wallet

Relayer, wallet, and Render changes are not in this PR. SDEMO and the Arb demo addresses stay as they are. These scripts do not call a setter on SDEMO.

## Simulated gas

Filled from the fork tests on 2026-10-13 (Base Sepolia and Arb Sepolia public RPCs, no broadcast). Deltas are `gasleft` around the inner call.

| Step | Call | Script gas delta |
| --- | --- | --- |
| B4 | `setTokenAllowed(gMOCK, false)` (also clears `eip2612Tokens`) | 14377 |
| B4 | `setRouterAllowed(0x94cC, false)` | 7636 |
| B1 | `new TestDemoFaucet()` | 1165355 |
| A1 | `new TestDemoFaucet()` | 1165405 |
| B2 | `new LockedDemoSwapRouter(...)` | 772367 |
| B3 | `setEip2612Token(tDEMO, true)` | 49099 |
| B3 | `setTokenAllowed(tDEMO, true)` | skipped (1433 gas in the `if`, not a tx) |
| B3 | `setRouterAllowed(newRouter, true)` | 24802 |
| A2 | `setEip2612Token(tDEMO, true)` | 49142 |
| A2 | `setTokenAllowed` / `setRouterAllowed` | skipped (1455 and 24 gas, not txs) |
| B5 | 0.05 ETH to router | 8860 |
| B5 | 0.02 ETH to relayer | 9550 |
| A3 | `setMaxPayout(0.0001 ether)` | 5786 |
