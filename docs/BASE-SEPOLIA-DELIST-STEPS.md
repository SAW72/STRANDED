# Base Sepolia delist steps (unsigned)

Spencer signs these two calls himself from `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. Chain id `84532` (Base Sepolia). Target is `GasRescueSwap` `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`.

No key is in this repo. These steps are not signed here and are not broadcast. The fork proof is `test/fork/BaseSepoliaDelistSteps.t.sol`: it impersonates the owner with `vm.prank` at block `48,077,171` and checks the state before and after each call.

## Facts the steps rely on

`src/GasRescueSwap.sol` exposes `setTokenAllowed(address,bool)`. There is no `setAllowedToken`. `cast sig "setTokenAllowed(address,bool)"` is `0x15f69012`. `cast sig "setAllowedToken(address,bool)"` is `0x8aaa2284`, and that selector is not the live setter.

gMOCK `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166` is publicly mintable (`mint(address,uint256)`) and allowlisted. At block `48,077,171` its supply is `10**39 + 10**19 + 1000` wei, about `1e39`.

`0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` is Uniswap SwapRouter02. It holds `0` ETH and it is not the capped router. The function that removes it from `allowedRouters` is `setRouterAllowed(address,bool)` in `src/GasRescueSwap.sol`. That is the only write to `allowedRouters`.

`setTokenAllowed(token, false)` also sets `eip2612Tokens[token]` to false in the same call. No second token transaction is required for that flag.

## Step 1 — delist gMOCK

| | |
|---|---|
| Chain id | `84532` |
| Target | `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688` |
| Function | `setTokenAllowed(address,bool)` |
| Args | `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166`, `false` |
| Calldata | `0x15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000000` |

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

## Step 2 — remove SwapRouter02 from the router allowlist

| | |
|---|---|
| Chain id | `84532` |
| Target | `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688` |
| Function | `setRouterAllowed(address,bool)` |
| Args | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`, `false` |
| Calldata | `0x6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000000` |

Calldata command:

```bash
cast calldata "setRouterAllowed(address,bool)" \
  0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 false
```

Take Uniswap SwapRouter02 off the router allowlist. A rescue that names it then reverts `RouterNotAllowed`. This call does not move the `0` ETH that contract holds.

Post-check (after the transaction is mined):

```bash
cast call 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688 \
  "allowedRouters(address)(bool)" \
  0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `false`. The same call returns `true` before this step. Balance stays zero:

```bash
cast balance 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected: `0`.
