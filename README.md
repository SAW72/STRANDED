# GasRescue (Scout #1, Base Sepolia)

Destination-only gas-deadlock rescue for **Base Sepolia**. A user who holds an allowlisted EIP-2612 ERC-20 but has **zero native ETH** signs an EIP-712 `Order` plus an EIP-2612 `permit`. An allowlisted relayer pays gas. The contract permit-pulls tokens, sends `feeAmount` to `feeTo`, and returns the remainder to `user`. Fail closed.

This is a Foundry thin slice. It is **not** multi-chain, **not** Solana, **not** a bridge-out, **not** mainnet, and **not** an ETH top-up fee model.

## Locked interface

```solidity
function rescueWithPermit(
    Order calldata order,
    bytes calldata orderSignature,
    uint8 v,
    bytes32 r,
    bytes32 s
) external;
```

`IGasRescue.Order` / EIP-712 typehash:

```
Order(address user,address token,uint256 amount,uint256 feeAmount,address feeTo,uint256 deadline,uint256 nonce)
```

| Field | Role |
| --- | --- |
| `user` | Token owner, Order signer, remainder destination |
| `token` | Allowlisted EIP-2612 ERC-20 |
| `amount` | Exact units pulled via `transferFrom` (no FoT slack) |
| `feeAmount` | In-token fee (`feeAmount < amount`) |
| `feeTo` | Fee sink (signed; not implied `msg.sender`) |
| `deadline` | Shared Order + permit expiry |
| `nonce` | GasRescue replay key (not the token permit nonce) |

Permit parameters are derived from the Order (`owner = user`, `spender = GasRescue`, `value = amount`, `deadline = deadline`).

## `rescueWithPermit` sequence

Modifiers: `nonReentrant`, `whenNotPaused`, `onlyRelayer`.

1. View-only checks — **no nonce write**: nonzero `user` / `token` / `feeTo`; `amount > 0`; `feeAmount < amount`; deadline; `allowedTokens[token]`; `!usedNonces[user][nonce]`; Base Sepolia (`84532`).
2. Recover EIP-712 signer; require `== order.user`.
3. `balanceOf(user) >= amount` else `Underfunded` — **still no nonce write**.
4. `usedNonces[user][nonce] = true`.
5. `permit(user, this, amount, deadline, v, r, s)`.
6. `transferFrom(user, this, amount)`.
7. Require `(balanceAfter - balanceBefore) == amount` else `FoTOrBalanceMismatch`.
8. `transfer(feeTo, feeAmount)` then `transfer(user, amount - feeAmount)`.
9. `emit Rescued(user, token, amount, feeAmount, feeTo, nonce, msg.sender)`.

A failed signature or underfunded user does **not** consume the nonce (the write has not happened yet). A later revert (permit / FoT / transfer) rolls the whole transaction back, including the nonce write.

Owner controls: `setRelayer`, `setTokenAllowed`, `pause` / `unpause`.

## Layout

```
src/GasRescue.sol
src/interfaces/IGasRescue.sol
src/mocks/MockERC20Permit.sol          # 18 decimals
src/mocks/MockFeeOnTransferToken.sol
src/mocks/ReentrantToken.sol
test/GasRescue.t.sol
script/Deploy.s.sol
script/Rescue.s.sol
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- A Base Sepolia deployer key funded with ETH (for deploy only)
- An allowlisted relayer address funded with ETH (pays user gas)

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
git submodule update --init --recursive
forge test -vv
```

## Tests

```bash
forge test -vv
```

Covered paths:

- Happy path (`feeTo` receives the fee; remainder returns to `user`; relayer is not the fee sink)
- Replay (same Order / same nonce)
- Wrong relayer / token not allowlisted / `setTokenAllowed` onlyOwner
- Pause / onlyOwner
- Fee-on-transfer rejected (`FoTOrBalanceMismatch`)
- Reentrancy via `permit` and via `transferFrom`
- Invalid signature and underfunded do **not** burn the nonce
- Permit not bound to Order `amount`
- Expiry, wrong chain, `feeAmount >= amount`

## Environment variables

Copy `.env.example` to `.env`. **Do not commit `.env` or any private key.**

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PRIVATE_KEY` | `Deploy.s.sol`, `Rescue.s.sol` | Deployer (owner) or relayer key |
| `RELAYER_ADDRESS` | `Deploy.s.sol` | First allowlisted relayer |
| `TOKEN_ADDRESS` | `Deploy.s.sol` (optional allow), `Rescue.s.sol` | EIP-2612 ERC-20 |
| `BASE_SEPOLIA_RPC_URL` | `forge script --rpc-url` | Base Sepolia HTTP endpoint |
| `ETHERSCAN_API_KEY` | optional `--verify` | Basescan API key |
| `USER_PRIVATE_KEY` | `Rescue.s.sol` demo | Test user signer only |
| `GAS_RESCUE_ADDRESS` | `Rescue.s.sol` | Deployed `GasRescue` |
| `ORDER_AMOUNT` | `Rescue.s.sol` | Raw units to pull |
| `ORDER_FEE_AMOUNT` | `Rescue.s.sol` | In-token fee (`feeAmount < amount`) |
| `ORDER_FEE_TO` | `Rescue.s.sol` | Fee sink |
| `ORDER_DEADLINE` | `Rescue.s.sol` | Unix seconds |
| `ORDER_NONCE` | `Rescue.s.sol` | Unused GasRescue nonce for `user` |

Public RPC default: `https://sepolia.base.org` (chain id `84532`). Explorer: https://sepolia.basescan.org

## Deploy (Base Sepolia)

```bash
cp .env.example .env
# edit .env — never paste keys into the repo

source .env
forge script script/Deploy.s.sol:DeployGasRescue \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --verify \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --chain-id 84532
```

The script refuses any chain other than Base Sepolia. Constructor: `initialOwner = deployer`, `initialRelayer = RELAYER_ADDRESS`. If `TOKEN_ADDRESS` is set, the script also calls `setTokenAllowed`.

Owner follow-ups:

```bash
cast send "$GAS_RESCUE_ADDRESS" "setRelayer(address,bool)" 0xAnotherRelayer true \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY"

cast send "$GAS_RESCUE_ADDRESS" "setTokenAllowed(address,bool)" "$TOKEN_ADDRESS" true \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY"

cast send "$GAS_RESCUE_ADDRESS" "pause()" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY"
```

## How the relayer calls it

1. Confirm the user has the allowlisted ERC-20 and not enough ETH to self-send.
2. Read `DOMAIN_SEPARATOR()`, `ORDER_TYPEHASH`, `usedNonces(user, nonce)`, and `allowedTokens(token)`.
3. Read the token's `nonces(user)` and `DOMAIN_SEPARATOR()` for the EIP-2612 permit.
4. Build `Order { user, token, amount, feeAmount, feeTo, deadline, nonce }`.
5. User signs two typed-data messages:
   - **EIP-712 Order** — domain `name = "GasRescue"`, `version = "1"`, `chainId = 84532`, `verifyingContract = GasRescue`.
   - **EIP-2612 Permit** — `owner = user`, `spender = GasRescue`, `value = amount`, `nonce = token.nonces(user)`, `deadline = order.deadline`.
6. Allowlisted relayer submits, paying Base Sepolia gas:

```bash
cast send "$GAS_RESCUE_ADDRESS" \
  "rescueWithPermit((address,address,uint256,uint256,address,uint256,uint256),bytes,uint8,bytes32,bytes32)" \
  "(${USER},${TOKEN},${AMOUNT},${FEE_AMOUNT},${FEE_TO},${DEADLINE},${NONCE})" \
  "$ORDER_SIGNATURE" \
  "$PERMIT_V" "$PERMIT_R" "$PERMIT_S" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$RELAYER_PRIVATE_KEY"
```

Demo script (test user key only): `script/Rescue.s.sol`. In production the user key stays in the wallet.

## Out of scope

- Other chains, mainnet, Solana
- Bridge-out or remainder destination other than `order.user`
- Native ETH top-up as the fee
- Accepting fee-on-transfer tokens (they revert `FoTOrBalanceMismatch`)
- Generic Permit2 / non-2612 tokens
- Production relayer infrastructure
