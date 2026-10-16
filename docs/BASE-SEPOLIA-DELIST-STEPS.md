# Base Sepolia delist steps (unsigned)

Testnet only. Each call needs the owner's explicit approval to sign.

The owner signs these two calls from `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. Chain id `84532` (Base Sepolia). Target is `GasRescueSwap` `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`.

That owner is a 7702-delegated EOA. At block `48,077,171` its code is `0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b`, so the delegate is `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`.

No key is in this repo. These steps are not signed here and are not broadcast. `test/fork/BaseSepoliaDelistSteps.t.sol` impersonates the owner with `vm.prank` and sends the exact calldata bytes below through `LIVE_SWAP.call`.

## Facts the steps rely on

`src/GasRescueSwap.sol` exposes `setTokenAllowed(address,bool)`. `cast sig "setTokenAllowed(address,bool)"` is `0x15f69012`. `cast sig "setAllowedToken(address,bool)"` is `0x8aaa2284`, and that name is not a function in the source.

gMOCK `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166` is publicly mintable (`mint(address,uint256)` succeeds from a non-owner) and allowlisted. At block `48,077,171` its supply is `10**39 + 10**19 + 1000` wei, about `1e39`.

`0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` is Uniswap SwapRouter02. At that block `WETH9()` returns `0x4200000000000000000000000000000000000006`. It holds `0` ETH and it is not the capped router. The function that removes it from `allowedRouters` is `setRouterAllowed(address,bool)`. That is the only write to `allowedRouters`.

`0x48aB70F0eeb92082100EFA49189654663F48f285` is also allowlisted as a router at that block. Step 2 does not clear it.

`setTokenAllowed(token, false)` also sets `eip2612Tokens[token]` to false in the same call.

## Pre-checks

`$BASE_SEPOLIA_RPC_URL` must be a Base Sepolia (chain id `84532`) JSON-RPC endpoint, for example `https://sepolia.base.org`. The chain-id pre-check must print `84532`.

Both reads must match before either signature.

```bash
cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `84532`.

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "owner()(address)" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`.

Sign Step 1 before Step 2. After Step 1 no token is allowlisted, so nothing can route through either router: `src/GasRescueSwap.sol` reverts `TokenNotAllowed` before `RouterNotAllowed`. If the router is removed first, gMOCK stays allowlisted and can still be rescued through `0x48aB70F0eeb92082100EFA49189654663F48f285`.

## Step 1 — delist gMOCK

| | |
|---|---|
| Chain id | `84532` |
| Target | `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688` |
| Function | `setTokenAllowed(address,bool)` |
| Args | `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166`, `false` |
| Calldata | `0x15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000000` |
| Gas estimate | `37086` (`cast estimate` from the owner at block `48,077,171`) |

Calldata command:

```bash
cast calldata "setTokenAllowed(address,bool)" \
  0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166 false
```

Take gMOCK off the token allowlist so a rescue of that mintable token reverts `TokenNotAllowed`.

Post-check (after the transaction is mined):

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedTokens(address)(bool)" \
  0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `false`. The same call returns `true` before this step. The EIP-2612 flag clears in the same transaction:

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "eip2612Tokens(address)(bool)" \
  0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `false`.

Post-sign events, both from `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`, in this order:

| Event | topic0 | topic1 | data |
|---|---|---|---|
| `Eip2612TokenAllowed(address,bool)` | `0x647301f4aeecbf064b3f4c62752f716c9b3f70ce0585c613d95bbe957576fb5c` | `0x000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd37166` | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| `TokenAllowed(address,bool)` | `0x9a8e30a8658b96ab3f034ce4bac6806278b4aee5880ccdd1ac35e4ed5bb31d23` | `0x000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd37166` | `0x0000000000000000000000000000000000000000000000000000000000000000` |

```bash
cast receipt <step-1 tx hash> --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

The receipt must contain those two topics. topic1 is gMOCK. data is `false`.

Rollback for this step is in the final section headed ROLLBACK ONLY: DO NOT SIGN unless reverting.

## Step 2 — remove SwapRouter02 from the router allowlist

| | |
|---|---|
| Chain id | `84532` |
| Target | `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688` |
| Function | `setRouterAllowed(address,bool)` |
| Args | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`, `false` |
| Calldata | `0x6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000000` |
| Gas estimate | `30990` (`cast estimate` from the owner at block `48,077,171`) |

Calldata command:

```bash
cast calldata "setRouterAllowed(address,bool)" \
  0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 false
```

Take Uniswap SwapRouter02 off the router allowlist. A rescue that names it then reverts `RouterNotAllowed`. This call does not move the `0` ETH that contract holds. `0x48aB70F0eeb92082100EFA49189654663F48f285` stays allowlisted.

Post-check (after the transaction is mined):

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedRouters(address)(bool)" \
  0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `false`. The same call returns `true` before this step.

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedRouters(address)(bool)" \
  0x48aB70F0eeb92082100EFA49189654663F48f285 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `true`.

```bash
cast balance 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `0`.

Post-sign event from `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`:

| Event | topic0 | topic1 | data |
|---|---|---|---|
| `RouterAllowed(address,bool)` | `0x5ae067a93e2af6193017728cb7e9ef5af1d750a5beb7b16a05b54d56f6f355e3` | `0x00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc4` | `0x0000000000000000000000000000000000000000000000000000000000000000` |

```bash
cast receipt <step-2 tx hash> --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

The receipt must contain that topic. topic1 is SwapRouter02. data is `false`.

Rollback for this step is in the final section headed ROLLBACK ONLY: DO NOT SIGN unless reverting.

## ROLLBACK ONLY: DO NOT SIGN unless reverting

These bytes put gMOCK or SwapRouter02 back on the allowlist. They are not part of the delist.

Sign order, from the fully delisted state. `setEip2612Token(gMOCK, true)` alone sets both `allowedTokens[gMOCK]` and `eip2612Tokens[gMOCK]`. That makes `setTokenAllowed(gMOCK, true)` redundant for a full token restore: one token blob suffices, and it is the EIP-2612 blob. `setTokenAllowed(gMOCK, true)` by itself sets `allowedTokens` and leaves `eip2612Tokens` false. The router blob does not change either token flag, so one blob does not revert the whole delist. Sign `setEip2612Token(0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166, true)`, then `setRouterAllowed(0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4, true)`.

Gas estimates below are from the fully delisted state at block `48,077,171` (both steps already applied). Each figure is its own `cast estimate` from the owner; the second and third are not measured after an earlier rollback blob. The wallet will re-estimate at signing time.

`setTokenAllowed(0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166, true)`. Gas estimate `47696`. This restores `allowedTokens` only.

`0x15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000001`

`setEip2612Token(0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166, true)`. Gas estimate `71738`. On this bytecode, `allowed == true` also sets `allowedTokens`.

`0xae6dda45000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000001`

`setRouterAllowed(0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4, true)`. Gas estimate `47899`.

`0x6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000001`
