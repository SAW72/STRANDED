# GasRescue (Scout #1, Base Sepolia)

Destination-only gas-deadlock rescue for **Base Sepolia**. A user who holds an EIP-2612 ERC-20 but has **zero native ETH** signs an EIP-712 `Order` plus an EIP-2612 `permit`. An allowlisted relayer pays gas. The contract permit-pulls tokens, skims an **in-token** fee to the relayer, and sends the measured remainder to the recipient. Fail closed.

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

`IGasRescue.Order`:

| Field | Bound by | Role |
| --- | --- | --- |
| `user` | EIP-712 + permit owner | Token owner / Order signer |
| `token` | EIP-712 + `permit` target | EIP-2612 ERC-20 |
| `amount` | EIP-712 + permit `value` | Max units pulled via `transferFrom` |
| `fee` | EIP-712 only | In-token skim to the calling relayer |
| `recipient` | EIP-712 only | Remainder destination (usually `user`) |
| `deadline` | EIP-712 + permit `deadline` | Shared expiry |
| `nonce` | EIP-712 + on-chain bitmap | GasRescue replay key (not the token permit nonce) |

Permit parameters are **derived from the Order** (`owner = user`, `spender = GasRescue`, `value = amount`, `deadline = deadline`). A permit signed for a different value or spender cannot be attached to the Order.

## Security (auditor rejects, now implemented)

- **Relayer allowlist** — `onlyRelayer`; `setRelayer` is `onlyOwner`.
- **Pause** — `pause` / `unpause` are `onlyOwner`; rescue is `whenNotPaused`.
- **`nonReentrant`** — blocks reentry from malicious `permit` / `transferFrom`.
- **Nonce before sig / external calls** — `usedNonces[user][nonce] = true` runs before `ECDSA.recover` and before `permit` / token transfers.
- **Permit binding** — permit call uses Order `token`, `amount`, `user`, `deadline`; fee / recipient / GasRescue nonce are in the Order digest.
- **Fee-on-transfer** — credit is `balanceOf(this)` after minus before. If `received <= fee`, revert (`InsufficientReceived`).
- **Chain lock** — `block.chainid` must be `84532` (Base Sepolia).
- **Fail closed** — replay, wrong caller, pause, expiry, bad signature, zero addresses, `fee >= amount`, FoT leftover, or wrong chain all revert. A reverted call restores the nonce.

## Layout

```
src/GasRescue.sol
src/interfaces/IGasRescue.sol
src/mocks/MockERC20Permit.sol
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
```

This repo vendors Foundry libs via git submodules. After clone:

```bash
git submodule update --init --recursive
forge test -vv
```

## Tests

```bash
forge test -vv
```

Covered paths:

- Happy path (user at 0 ETH, relayer pays gas, fee + remainder)
- Replay (same Order / same nonce)
- Wrong allowlist
- Pause / onlyOwner
- Fee-on-transfer balance delta + fail-closed leftover
- Reentrancy via `permit` and via `transferFrom`
- Permit not bound to Order `amount`
- Invalid Order signature, expiry, wrong chain, `fee >= amount`

## Environment variables

Copy `.env.example` to `.env`. **Do not commit `.env` or any private key.**

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PRIVATE_KEY` | `Deploy.s.sol`, `Rescue.s.sol` | Deployer (owner) or relayer key |
| `RELAYER_ADDRESS` | `Deploy.s.sol` | First allowlisted relayer |
| `BASE_SEPOLIA_RPC_URL` | `forge script --rpc-url` | Base Sepolia HTTP endpoint |
| `ETHERSCAN_API_KEY` | optional `--verify` | Basescan API key |
| `USER_PRIVATE_KEY` | `Rescue.s.sol` demo | Test user signer only (not broadcast as the rescue tx) |
| `GAS_RESCUE_ADDRESS` | `Rescue.s.sol` | Deployed `GasRescue` |
| `TOKEN_ADDRESS` | `Rescue.s.sol` | EIP-2612 ERC-20 |
| `ORDER_AMOUNT` | `Rescue.s.sol` | Raw units to pull |
| `ORDER_FEE` | `Rescue.s.sol` | In-token relayer fee (`fee < amount`) |
| `ORDER_RECIPIENT` | `Rescue.s.sol` | Remainder recipient |
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

The script refuses any chain other than Base Sepolia. Constructor arguments: `initialOwner = deployer`, `initialRelayer = RELAYER_ADDRESS`.

Owner follow-ups (from the deployer key):

```bash
cast send "$GAS_RESCUE_ADDRESS" "setRelayer(address,bool)" 0xAnotherRelayer true \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY"

cast send "$GAS_RESCUE_ADDRESS" "pause()" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY"
```

## How the relayer calls it

1. Confirm the user has the ERC-20 and **no ETH** (or not enough) to self-send.
2. Read `GasRescue.DOMAIN_SEPARATOR()`, `ORDER_TYPEHASH`, and `usedNonces(user, nonce)` (pick an unused nonce).
3. Read the token's `nonces(user)` and `DOMAIN_SEPARATOR()` for the EIP-2612 permit.
4. Build `Order { user, token, amount, fee, recipient, deadline, nonce }` with `fee < amount` and a near-term `deadline`.
5. User signs two typed-data messages in their wallet:
   - **EIP-712 Order** — domain `name = "GasRescue"`, `version = "1"`, `chainId = 84532`, `verifyingContract = GasRescue`.
   - **EIP-2612 Permit** — `owner = user`, `spender = GasRescue`, `value = order.amount`, `nonce = token.nonces(user)`, `deadline = order.deadline`.
6. Relayer (allowlisted EOA or bot) submits, paying Base Sepolia gas:

```bash
cast send "$GAS_RESCUE_ADDRESS" \
  "rescueWithPermit((address,address,uint256,uint256,address,uint256,uint256),bytes,uint8,bytes32,bytes32)" \
  "(${USER},${TOKEN},${AMOUNT},${FEE},${RECIPIENT},${DEADLINE},${NONCE})" \
  "$ORDER_SIGNATURE" \
  "$PERMIT_V" "$PERMIT_R" "$PERMIT_S" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$RELAYER_PRIVATE_KEY"
```

On-chain sequence: allowlist + pause + reentrancy checks → chain / order validation → **mark nonce used** → recover Order signer → `permit(user, this, amount, deadline, v, r, s)` → `transferFrom` → measure delta → pay `fee` to `msg.sender` → pay remainder to `recipient`.

For a local demo that signs both messages from a test `USER_PRIVATE_KEY`, use `script/Rescue.s.sol`. In production the user key never leaves the wallet; the relayer only receives the two signatures.

```bash
source .env
forge script script/Rescue.s.sol:RescueWithPermit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --chain-id 84532
```

## Out of scope

- Other chains, mainnet, Solana
- Bridge-out or destination-change beyond `order.recipient` on Base Sepolia
- Native ETH top-up as the fee (fee is the ERC-20)
- Generic Permit2 / non-2612 tokens
- Production relayer infrastructure, mempool privacy, or fee quoting
