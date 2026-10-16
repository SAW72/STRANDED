# tDEMO supply — simulate only (Base Sepolia and Arb Sepolia)

Testnet only. Never mainnet. No broadcast from this repo. No keys in git. The owner signs from owner EOA `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` with his keystore. Arb Sepolia stays the main demo. SDEMO is unchanged.

Token name: **Stranded TEST Demo — No Value**. Symbol: **tDEMO**. Decimals: 18. Fixed supply: **1e12** tDEMO, minted once to a no-owner faucet. `drip()` pays **2 tDEMO** per wallet per **24 hours** and reverts `FaucetEmpty` when the faucet cannot pay that. No mint. No owner. No withdraw.

On-chain notice: `Testnet only (Base Sepolia 84532 or Arbitrum Sepolia 421614). No monetary value. Not for sale. Not a reward.`

Scripts: `script/TestDemoSupply.s.sol`. Dry-run is the default and needs no env flag. `forge script` without `--broadcast` does not read `TEST_DEMO_BROADCAST_OK` or `TEST_DEMO_BROADCAST_STEP`.

Every step still checks the sender and the chain on a dry-run. The sender must be `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` (the Foundry default sender `0x1804…1f38` reverts `FoundryDefaultSender`). `block.chainid` must be that step's chain, and that chain must be 84532 or 421614. B4, B2, and B5 revert `WrongChain` on 421614. A3 reverts `WrongChain` on 84532.

Never pass a `--chain-id` that differs from the RPC. `forge script --chain-id` changes only `block.chainid`. On a `forge script` run the guard also reads `eth_chainId` from that RPC and reverts `RpcChainMismatch` when the two differ. That catches a Base id pointed at an RPC whose real id is something else, including a local chain whose id is 1. Requiring code at the Base or Arb swap was not added: the local anvil that proves the broadcast gate has no code at the swap, and a fork that copied the swap's bytecode would still pass a code-length check. `forge test` is not a script context, so the guard does not call `vm.rpc` there and the unit tests keep using `block.chainid`.

`--broadcast` is `vm.isContext(ScriptBroadcast)`. In that context the same chain and sender checks apply, and both env values must match exactly: `TEST_DEMO_BROADCAST_OK=1` and `TEST_DEMO_BROADCAST_STEP` equal to that one step's id (`B4`, `B1`, `B2`, `B3`, `B5`, `A1`, `A3`, or `A2`). `0`, `true`, and empty are not `1`. The gate also rejects a raw `1 ` (trailing space) when that value is supplied to the reader directly. On Foundry 1.8.5 a shell value `TEST_DEMO_BROADCAST_OK='1 '` is read by `vm.envOr` as `1` with length 1 (observed with `forge script` against local anvil: the logged length was 1 and the logged value was `1`). A flag for B4 does not broadcast B1. Anything else reverts `BroadcastRefused` before `vm.startBroadcast`.

`--resume` does not run the script, so it is NOT gated; it replays whatever is in `broadcast/**/run-latest.json`; delete `broadcast/**/dry-run` before signing; never use `--resume` unless a live `run-latest.json` from a real broadcast of that same step exists. A dry-run writes `broadcast/TestDemoSupply.s.sol/<chainid>/dry-run/run-latest.json`. `forge script --resume` with no env flags submits that file. No Solidity runs, so `BroadcastRefused` is never evaluated.

`SimulateBaseSupply` and `SimulateArbSupply` revert `AggregatorNeverBroadcasts` in a broadcast context before any step, even if the flags would allow the first step. They are dry-run only.

This guard does not stop someone from editing the script, deleting the gate, broadcasting some other contract, or replaying a saved JSON with `--resume`. It only binds these entrypoints when the script actually runs. Keystore placeholder on every broadcast the owner runs:

```bash
TEST_DEMO_BROADCAST_OK=1 \
TEST_DEMO_BROADCAST_STEP=B4 \
forge script script/TestDemoSupply.s.sol:B4_DelistStaleAllowlist \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain-id 84532 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

Repeat with `TEST_DEMO_BROADCAST_STEP` set to the one contract being signed (`B1`, `B2`, `B3`, `B5`, `A1`, `A3`, `A2`). On Arb the order is A1, then A3, then A2. Simulation omits `--broadcast`, `--account`, and both env vars, and passes only `--sender`. The `--chain-id` flag must be the same id the RPC returns. Copy addresses from receipts. Do not paste a predicted CREATE address into a later step. Do not pass `--resume`. `--resume` does not run the script, so it is NOT gated; it replays whatever is in `broadcast/**/run-latest.json`; delete `broadcast/**/dry-run` before signing; never use `--resume` unless a live `run-latest.json` from a real broadcast of that same step exists. Fork tests revert `MissingRpc` when their RPC URL is unset. They do not skip.

Gas figures below are the script's `gasleft` deltas around each call (the inner call, not the 21,000 intrinsic). They come from the fork tests calling the same script helpers against a fork of the live chain, with no broadcast. B5's value transfers were measured after the fork dealt the owner up to exactly 0.071 ETH (0.07 ETH of transfers plus 0.001 ETH headroom). His live Base balance (about 0.0583 ETH) is short of that. The live `forge script` of B5 reverts `Underfunded` until that balance is there. A balance of exactly 0.07 ETH also reverts. `setTokenAllowed` after `setEip2612Token(true)` is a skipped branch on this bytecode (`setEip2612Token(true)` already sets `allowedTokens`), so that delta is not a transaction. A2's `setRouterAllowed` delta is the skipped `if (base)` branch.

## Who signs

| Step | Chain | Signer | Contract |
| --- | --- | --- | --- |
| B4, B1, B2, B3, B5 | Base Sepolia 84532 | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` | `GasRescueSwap` `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688` plus new contracts |
| A1, A3, A2 | Arb Sepolia 421614 | same owner | `GasRescueSwap` `0x65e712222745A8FCCbF038A90Fa75caB0867993D` and router `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` |

The relayer hot wallet `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` receives ETH in B5. It does not sign these steps.

## Base order

Run **B4, then B1, then B2, then B3, then B5**. Delist before deploy. Fund last, and only after the new token and router are allowlisted.

### B4 — delist stale allowlist

`B4_DelistStaleAllowlist`. Two calls on `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`, the same two as `docs/BASE-SEPOLIA-DELIST-STEPS.md`. `setTokenAllowed(token, false)` also sets `eip2612Tokens[token]` to false. There is no second token transaction.

1. `setTokenAllowed(0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166, false)`
   calldata `0x15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000000`
2. `setRouterAllowed(0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4, false)`
   calldata `0x6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000000`

gMOCK has public `mint`. Router `0x94cC…2bc4` is the Uniswap V3 SwapRouter02 on Base Sepolia. B4 delists it so the tDEMO allowlist contains only the locked demo router. It holds 0 ETH and is not the capped router. Do not fund it. After step 1, `allowedTokens` and `eip2612Tokens` for gMOCK are both false.

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

Order is **A1, then A3, then A2**. Same token and faucet. SDEMO `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C` stays allowlisted. The scripts do not call a setter on it. A3 is not optional and is not skipped. A2 reverts `A2: sign A3 first` until `maxPayout` on `0xFE22…f7fc` is at most 0.0001 ETH. If the SDEMO judging freeze blocks A3, do not sign A2 either: until A3, each 2 tDEMO rescue pays the live 0.001 ETH cap, and the faucet can open a new wallet for each drip.

### A1 — deploy

Same contract as B1, chain 421614. To simulate, omit `--broadcast`, `--account`, and both env vars. Do not pass `--resume`.

```bash
TEST_DEMO_BROADCAST_OK=1 \
TEST_DEMO_BROADCAST_STEP=A1 \
forge script script/TestDemoSupply.s.sol:B1_DeployTestDemoFaucet \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

### A3 — lower `maxPayout` before A2

Reuse `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`. Do not deploy a second router. A3 must be signed before A2.

Checked on a fork of Arb Sepolia before A3:

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

Until A3, one faucet drip of 2 tDEMO quotes 0.001 ETH. Nineteen such wallets take 0.019 ETH and leave 0.0005 ETH. That is the shared SDEMO router.

- The call is owner-settable. One transaction. It does not move the 0.0195 ETH.
- After it, `quote(2 ether)` is 0.0001 ETH, so one faucet drip hits the cap, matching Base.
- `payAmount()` stays 0.0001 ETH, because 0.2 token already quotes exactly that.
- 0.0195 / 0.0001 = **195** rescues on the ETH already in the router.
- Funding from free faucets instead leaves the 0.001 ETH drain. Reaching 195 rescues that way needs about **0.1755 ETH** more (0.195 total). Funding is a later top-up, not the lever that bounds a drip.

SDEMO caveat: this PR does not change the SDEMO disclaimer. Today it says 2 SDEMO can draw up to 0.001 ETH and the full 20 up to 0.01 ETH, and it says not to change `setMaxPayout` during judging. A3 makes a 2-token rescue pay 0.0001 ETH (full 20 SDEMO would draw at most 0.001 ETH). The 0.2-token slice does not change. If that judging freeze is in force, do not sign A3 and do not sign A2. The SDEMO token, its allowlist, and its addresses stay as they are either way.

```bash
TEST_DEMO_BROADCAST_OK=1 \
TEST_DEMO_BROADCAST_STEP=A3 \
forge script script/TestDemoSupply.s.sol:A3_SetArbMaxPayout \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

Call: `setMaxPayout(100000000000000)` on `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`.

### A2 — allowlist tDEMO only, after A3

`B3_AllowlistTestDemo` on chain 421614. `ROUTER_ADDRESS` is not used. The script keeps router `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` and reverts if a different router is passed. It also reverts unless that router's `maxPayout` is at most 0.0001 ETH. To simulate, omit `--broadcast`, `--account`, and both env vars.

```bash
TEST_DEMO_BROADCAST_OK=1 \
TEST_DEMO_BROADCAST_STEP=A2 \
TOKEN_ADDRESS=<A1 receipt> \
forge script script/TestDemoSupply.s.sol:B3_AllowlistTestDemo \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

Call: `setEip2612Token(tDEMO, true)` on `0x65e712222745A8FCCbF038A90Fa75caB0867993D`. That sets `allowedTokens` and `eip2612Tokens` on the live bytecode.

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
| A3 | `setMaxPayout(0.0001 ether)` | 5786 |
| B2 | `new LockedDemoSwapRouter(...)` | 772367 |
| B3 | `setEip2612Token(tDEMO, true)` | 49099 |
| B3 | `setTokenAllowed(tDEMO, true)` | skipped (1433 gas in the `if`, not a tx) |
| B3 | `setRouterAllowed(newRouter, true)` | 24802 |
| A2 | `setEip2612Token(tDEMO, true)` | 49142 |
| A2 | `setTokenAllowed` / `setRouterAllowed` | skipped (1455 and 24 gas, not txs) |
| B5 | 0.05 ETH to router | 8860 |
| B5 | 0.02 ETH to relayer | 9550 |

## Post-checks

Read-only. Run these after the owner signs a step. They match the `require` lines in `script/TestDemoSupply.s.sol`. Addresses written `<…>` come from that step's receipt. Do not substitute a predicted CREATE address. On Arb the signing order is A1, then A3, then A2.

### B4

On Base swap `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`. Each call returns `false`.

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedTokens(address)(bool)" 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "eip2612Tokens(address)(bool)" 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedRouters(address)(bool)" 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

### B1 and A1

On the tDEMO address from the receipt. `faucet()` is the faucet address from the same receipt. `totalSupply()` and `balanceOf(faucet)` are both `1000000000000000000000000000000` (1e12 tDEMO, 18 decimals). `symbol()` is `tDEMO`. Use `$BASE_SEPOLIA_RPC_URL` for B1 and `$ARB_SEPOLIA_RPC_URL` for A1.

```bash
cast call <tDEMO> "faucet()(address)" --rpc-url "$RPC"
cast call <tDEMO> "totalSupply()(uint256)" --rpc-url "$RPC"
cast call <tDEMO> "balanceOf(address)(uint256)" <faucet> --rpc-url "$RPC"
cast call <tDEMO> "symbol()(string)" --rpc-url "$RPC"
```

### B2

On the router from the B2 receipt. `rescue()` is `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`. `owner()` is `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. `maxPayout()` and `quote(2 ether)` are both `100000000000000` (0.0001 ETH). Balance is 0.

```bash
cast call <router> "rescue()(address)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <router> "owner()(address)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <router> "maxPayout()(uint256)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <router> "quote(uint256)(uint256)" 2000000000000000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast balance <router> --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

### B3

On Base swap `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`. `allowedTokens(tDEMO)` and `eip2612Tokens(tDEMO)` are true. `allowedRouters(<router>)` is true. `allowedRouters(0x94cC…2bc4)` and `allowedTokens(gMOCK)` stay false.

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedTokens(address)(bool)" <tDEMO> --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "eip2612Tokens(address)(bool)" <tDEMO> --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedRouters(address)(bool)" <router> --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedRouters(address)(bool)" 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedTokens(address)(bool)" 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

### B5

`cast balance` on the B2 router is 0.05 ETH higher than before B5. `cast balance` on `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` is 0.02 ETH higher than before B5.

```bash
cast balance <router> --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast balance 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6 --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

### A3

On `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`. `maxPayout()` is `100000000000000` (0.0001 ETH). `quote(2 ether)` is the same value. `payAmount()` stays `100000000000000`. The router balance is unchanged. Sign this before A2.

```bash
cast call 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc \
  "maxPayout()(uint256)" --rpc-url "$ARB_SEPOLIA_RPC_URL"
cast call 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc \
  "quote(uint256)(uint256)" 2000000000000000000 --rpc-url "$ARB_SEPOLIA_RPC_URL"
cast call 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc \
  "payAmount()(uint256)" --rpc-url "$ARB_SEPOLIA_RPC_URL"
cast balance 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc --rpc-url "$ARB_SEPOLIA_RPC_URL"
```

### A2

On Arb swap `0x65e712222745A8FCCbF038A90Fa75caB0867993D`. tDEMO `allowedTokens` and `eip2612Tokens` are true. `allowedRouters(0xFE22…f7fc)` stays true. SDEMO `allowedTokens` and `eip2612Tokens` stay true. Run these only after A3.

```bash
cast call 0x65e712222745A8FCCbF038A90Fa75caB0867993D \
  "allowedTokens(address)(bool)" <tDEMO> --rpc-url "$ARB_SEPOLIA_RPC_URL"
cast call 0x65e712222745A8FCCbF038A90Fa75caB0867993D \
  "eip2612Tokens(address)(bool)" <tDEMO> --rpc-url "$ARB_SEPOLIA_RPC_URL"
cast call 0x65e712222745A8FCCbF038A90Fa75caB0867993D \
  "allowedRouters(address)(bool)" 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc \
  --rpc-url "$ARB_SEPOLIA_RPC_URL"
cast call 0x65e712222745A8FCCbF038A90Fa75caB0867993D \
  "allowedTokens(address)(bool)" 0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C \
  --rpc-url "$ARB_SEPOLIA_RPC_URL"
cast call 0x65e712222745A8FCCbF038A90Fa75caB0867993D \
  "eip2612Tokens(address)(bool)" 0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C \
  --rpc-url "$ARB_SEPOLIA_RPC_URL"
```

## Rollback

Do not sign unless undoing a step that was already signed. These commands are for the owner to review. They are not run from this repo, from CI, or by an agent. No key is written here. `--account <owner-keystore>` is a placeholder for the owner's keystore. `--resume` does not run the script, so it is NOT gated; it replays whatever is in `broadcast/**/run-latest.json`; delete `broadcast/**/dry-run` before signing; never use `--resume` unless a live `run-latest.json` from a real broadcast of that same step exists.

`setTokenAllowed(token, false)` also sets `eip2612Tokens[token]` to false. `setEip2612Token(token, true)` also sets `allowedTokens[token]` to true. `setEip2612Token(token, false)` does not clear `allowedTokens`.

### B4

Restore gMOCK with one token call (`setEip2612Token(true)` sets both flags), then put the Uniswap V3 SwapRouter02 back on the router allowlist.

```bash
cast send 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "setEip2612Token(address,bool)" 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166 true \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain 84532 \
  --account <owner-keystore> --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D
cast send 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "setRouterAllowed(address,bool)" 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 true \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain 84532 \
  --account <owner-keystore> --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D
```

### B1 and A1

The faucet and tDEMO are CREATEs. No owner call destroys them.

### B2

The Base router is a CREATE. No owner call destroys it. Its balance is 0 until B5.

### B3

`setTokenAllowed(tDEMO, false)` clears both token flags. Then remove the new router. Do not pass `0x94cC…2bc4`.

```bash
cast send 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "setTokenAllowed(address,bool)" <tDEMO> false \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain 84532 \
  --account <owner-keystore> --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D
cast send 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "setRouterAllowed(address,bool)" <router> false \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain 84532 \
  --account <owner-keystore> --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D
```

### A2

Clear tDEMO only. This does not call a setter on SDEMO and does not change `allowedRouters(0xFE22…f7fc)`.

```bash
cast send 0x65e712222745A8FCCbF038A90Fa75caB0867993D \
  "setTokenAllowed(address,bool)" <tDEMO> false \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain 421614 \
  --account <owner-keystore> --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D
```

### B5

`withdrawEth` on the B2 router pulls the 0.05 ETH back to the owner. The 0.02 ETH sent to `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` has no owner setter on the swap. This section does not include a transfer from the relayer key.

```bash
cast send <router> \
  "withdrawEth(address,uint256)" 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D 50000000000000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain 84532 \
  --account <owner-keystore> --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D
```

### A3

Puts `maxPayout` back to 0.001 ETH. Clear tDEMO first (the A2 undo above). Leaving tDEMO allowlisted against this cap reopens the 0.001 ETH drain. The SDEMO judging freeze still applies: do not sign this while that freeze is in force.

```bash
cast send 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc \
  "setMaxPayout(uint256)" 1000000000000000 \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain 421614 \
  --account <owner-keystore> --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D
```
