# GasRescue (Scout #1)

**Product:** `GasRescueSwap` — stranded token → swap a slice for native gas → same-chain move-out of the remainder.

**Harness:** `GasRescue.sol` is an in-token fee skim kept for regression. It is **not** the product.

Testnet only: **Base Sepolia (84532)** and **Arb Sepolia (421614)**. No mainnet code path. No bridge adapter in v1. Auditor-bot design APPROVE unblocks this implementation; a third-party firm audit is still required before mainnet.

See [docs/AUDITOR.md](docs/AUDITOR.md). Issues: [#3](https://github.com/SAW72/gas-rescue/issues/3), [#4](https://github.com/SAW72/gas-rescue/issues/4).

## Product: `GasRescueSwap`

A user who holds an allowlisted ERC-20 but has **zero native ETH** signs an EIP-712 `Order` plus gasless auth (EIP-2612 permit, or Permit2 if owner-enabled). An allowlisted relayer pays gas. The contract:

1. Pre-skims `feeAmount` of `tokenIn` to `feeTo`
2. Requires `amountSwap + feeAmount <= amountIn` (overflow-safe)
3. Sends remainder ERC-20 to `to` (same-chain move-out)
4. Calls the signed allowlisted `router` with calldata whose `keccak256` equals `pathHash`. The swap leg must consume **exactly** `amountSwap` (leftover `tokenIn` reverts; it is never forwarded to `to`)
5. Unwraps **this job's** WETH delta and credits **this job's** native delta to `nativeTo` (≥ `minAmountOut`, fail closed). Never sweeps `address(this).balance`
6. End-of-tx zeros: `tokenIn`, WETH, and ETH on the contract must be `0`

Never treats `msg.sender` as a user / fee / remainder / native substitute. Atomic all-or-nothing; no on-chain partial fills. Owner ≠ relayer hot key. Owner is OpenZeppelin `Ownable2Step`; `renounceOwnership` is disabled. **Mainnet must use a multisig or timelock for the owner role** (docs-only; not implemented or deployed on testnet). Non-proxy, `nonReentrant`, owner-only pause + allowlists.

### Locked EIP-712

Domain: `name = StewardGasRescue`, `version = 1`, `chainId`, `verifyingContract`.

```
Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)
```

Native recipient field is **`nativeTo`** (not `safeRecipient`).

### Auth

- EIP-2612 tokens must be owner-allowlisted (`setEip2612Token`). Do not allowlist hostile tokens. After the pull, the user's `balanceOf` drop and the contract `tokenIn` delta must both equal `amountIn`.
- Permit2 address is **constructor-immutable**: `address(0)` (unwired) or canonical Uniswap Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`. Any other constructor address reverts. Gated off by default (`permit2Enabled = false`). `setPermit2` reverts; owner may only toggle `setPermit2Enabled` for the frozen address. `rescueWithPermit2` reverts `NoGaslessAuth` unless enabled. The pull uses `permitWitnessTransferFrom` with the Order struct hash as witness, then requires the user's `balanceOf` drop == `amountIn`.
- Non-permit tokens with Permit2 disabled fail closed. There is no “just transferFrom” path.

### Sequence (`rescueWithPermit` / `rescueWithPermit2`)

Modifiers: `nonReentrant`, `whenNotPaused`, `onlyRelayer`.

1. View-only checks — **no nonce write**: testnet + `order.chainId == block.chainid`; nonzero addresses; `amountSwap + feeAmount <= amountIn`; `minAmountOut > 0`; deadline; token + router allowlists; unused nonce; `keccak256(swapData) == pathHash`.
2. Recover EIP-712 signer; require `== order.user`.
3. `balanceOf(user) >= amountIn` else `Underfunded` — **still no nonce write**.
4. Gasless-auth gate (`eip2612Tokens` or enabled Permit2) else `NoGaslessAuth` — **still no nonce write**.
5. `usedNonces[user][nonce] = true`.
6. Permit / Permit2 pull; user `balanceOf` drop and contract `tokenIn` delta must equal `amountIn` (`FoTOrBalanceMismatch`).
7. Appendix A: fee → `feeTo`; remainder ERC-20 → `to` (before swap); router must consume exactly `amountSwap`; this job's native delta → `nativeTo` ≥ `minAmountOut`; contract `tokenIn` / WETH / ETH == 0.

User errors (bad sig, underfunded, wrong domain, path mismatch) do not consume the nonce. Later execution reverts roll the nonce write back.

## Prerequisites

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

`GasRescueSwap` coverage: happy-path mock swap (native + WETH unwrap, both testnets), exact `amountSwap` consume (leftover tokenIn reverts), job-only native credit (donated ETH/WETH not swept), end-of-tx tokenIn/WETH/ETH zeros, Permit2 Order witness binding, slippage, underfunded / path / domain / sig without nonce burn, replay, wrong `chainId` / mainnet blocked, `feeAmount + amountSwap` overflow, FoT, reentrancy (permit / transferFrom / router), non-permit and disabled Permit2 fail-closed, owner ≠ relayer, two-step `Ownable2Step` transfer + disabled `renounceOwnership`, pause.

Harness tests in `test/GasRescue.t.sol` stay green.

## Environment

Copy `.env.example` to `.env`. **Do not commit `.env` or any private key.**

The Relayer hot key is **not** stored in `.env`, the workspace, or any generated file. GitHub Actions consumes it only at runtime from the repository secret named `RELAYER_PRIVATE_KEY` (Settings → Secrets and variables → Actions). Never paste that value into chat, the editor, or a tracked file. See [`.github/workflows/relayer.yml`](.github/workflows/relayer.yml) (`jobs.runtime` step **Consume RELAYER_PRIVATE_KEY at runtime**). The Tests workflow does not receive this secret. CI defaults to `STUB_RPC=1` (no live RPC, no broadcast). Testnet only: Base Sepolia (`84532`) and Arb Sepolia (`421614`).

| Variable | Purpose |
| --- | --- |
| `PRIVATE_KEY` | Deployer (owner). Must not equal `RELAYER_ADDRESS`. Local demo scripts only. |
| `RELAYER_ADDRESS` | First allowlisted relayer hot key. |
| `RELAYER_PRIVATE_KEY` | **GitHub Actions secret only.** Relayer signer. Injected at runtime; never written to disk. |
| `WETH_ADDRESS` | Required. Set per testnet; no mainnet fallback. |
| `ROUTER_ADDRESS` | Optional post-deploy router allowlist. |
| `TOKEN_ADDRESS` | Optional EIP-2612 allowlist. |
| `PERMIT2_ADDRESS` | Constructor-immutable. `address(0)` (unwired) or canonical Uniswap Permit2. |
| `PERMIT2_ENABLED` | Not set at deploy; `permit2Enabled` always starts `false`. |
| `BASE_SEPOLIA_RPC_URL` | Default `https://sepolia.base.org` |
| `ARB_SEPOLIA_RPC_URL` | Default `https://sepolia-rollup.arbitrum.io/rpc` |

WETH references (set `WETH_ADDRESS`; not script defaults):

- Base Sepolia: `0x4200000000000000000000000000000000000006`
- Arb Sepolia: `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73`

## Deploy (testnet only)

```bash
source .env
# Base Sepolia
forge script script/DeployGasRescueSwap.s.sol:DeployGasRescueSwap \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast --chain-id 84532

# Arb Sepolia
forge script script/DeployGasRescueSwap.s.sol:DeployGasRescueSwap \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" \
  --broadcast --chain-id 421614
```

The script reverts on any chain other than 84532 / 421614. Constructor: `initialOwner = deployer`, `initialRelayer = RELAYER_ADDRESS`, `weth = WETH_ADDRESS`.

Demo execute (test user key only): `script/RescueSwap.s.sol`.

## Layout

```
src/GasRescueSwap.sol              # product
src/interfaces/IGasRescueSwap.sol
src/interfaces/IPermit2.sol
src/interfaces/IWETH.sol
src/GasRescue.sol                  # fee-skim harness
src/interfaces/IGasRescue.sol
src/mocks/…
test/GasRescueSwap.t.sol
test/GasRescue.t.sol
test/audit/F5F6Audit.t.sol
script/DeployGasRescueSwap.s.sol
script/RescueSwap.s.sol
script/Deploy.s.sol                # harness
script/Rescue.s.sol                # harness
```

## Live (testnet)

**Relayer (Arb Sepolia):** https://stranded-relayer-arb.onrender.com — live quotes/signing (`stubRpc=false`). Hot wallet `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6`. Runtime `RELAYER_PRIVATE_KEY` only (never disk).

| Chain | GasRescueSwap | Mock / notes |
| --- | --- | --- |
| Arb Sepolia `421614` | [`0x65e712222745A8FCCbF038A90Fa75caB0867993D`](https://sepolia.arbiscan.io/address/0x65e712222745A8FCCbF038A90Fa75caB0867993D) | Mock gMOCK `0x30006e29a23c713070136F56db1BDf2A8B82B318`; router `0x680410c7f64e06eb7e80dc7b5c149f7855e225a8`; WETH `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
| Base Sepolia `84532` | [`0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`](https://sepolia.basescan.org/address/0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688) | Mock `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166`; router `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`; WETH `0x4200000000000000000000000000000000000006` |

Permit2 stays **disabled** on both deploys. Owner `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. Demo video: https://youtu.be/GzAfCQwoq88

## Still out of scope

- Bridge / cross-chain move-out
- Mainnet, token launch, paid firm-audit packaging

## Appendix: fee-skim harness (`GasRescue`)

Kept compiling so existing tests remain a regression gate. Destination-only skim on **Base Sepolia**: permit-pull `amount`, send `feeAmount` to `feeTo`, return remainder to `user`. Domain name `GasRescue` / version `1`. Same ownership hardening as the product: `Ownable2Step`, `renounceOwnership` disabled. See `test/GasRescue.t.sol` and `script/Deploy.s.sol`.
