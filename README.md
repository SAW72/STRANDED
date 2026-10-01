Stranded

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## License

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 Steward of the King LLC.

**Product:** `GasRescueSwap` — stranded token → swap a slice for native gas → same-chain move-out of the remainder.

**Harness:** `GasRescue.sol` is an in-token fee skim kept for regression. It is **not** the product.

Testnet only: **Base Sepolia (84532)** and **Arb Sepolia (421614)**. No mainnet code path. No bridge adapter in v1. Auditor-bot design APPROVE unblocks this implementation; a third-party firm audit is still required before mainnet.

Current operator snapshot: [SECURITY.md](SECURITY.md). The 2026-09-02 write-up is [docs/AUDIT-FINDINGS.md](docs/AUDIT-FINDINGS.md) (Finding 1 there is stale). See [docs/AUDITOR.md](docs/AUDITOR.md). Issues: [#3](https://github.com/SAW72/gas-rescue/issues/3), [#4](https://github.com/SAW72/gas-rescue/issues/4).

HackQuest / Arbitrum Open House — **Arb Sepolia first** (`421614`; Base secondary). [docs/BUILDATHON_PROGRESS.md](docs/BUILDATHON_PROGRESS.md) Day-5 + [issue #24](https://github.com/SAW72/STRANDED/issues/24). Day-1 Lens, Day-2 demo path, Day-3 fail-closed readiness, Day-4 Arb KNOW snapshot, Day-5 judge path. As of 2026-10-01 the hot wallet is above the 0.10 ETH floor, so `HackQuestStatus` recommends `live-submit-ok-if-user-funded`. Do not remake the video. Judged product stays `GasRescueSwap`. `StrandedRegistry` is merged and is **not** the deliverable. Live QA: [docs/QA_ARB_SEPOLIA_RESCUE.md](docs/QA_ARB_SEPOLIA_RESCUE.md).

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

`GasRescueLens` unit tests cover status / readiness (including `amountIn==0` probe ≠ ready) / order hash / F-1 immutability probes / `hackQuestReport`. `ArbSepoliaDemoPath` covers the live demo-router `pathHash` formula. `test/fork/*` hit live Sepolia and **skip** when `ARB_SEPOLIA_RPC_URL` / `BASE_SEPOLIA_RPC_URL` are unset (CI `forge test` stays offline). Spencer-watchable Arb rescue steps: [docs/QA_ARB_SEPOLIA_RESCUE.md](docs/QA_ARB_SEPOLIA_RESCUE.md).

Harness tests in `test/GasRescue.t.sol` stay green.

Wallet UX: `cd wallet && npm test && npm run build` (CI job **Wallet build + test**). Relayer URLs unset → labeled fixtures, not live quotes.

## Environment

Copy `.env.example` to `.env`. **Do not commit `.env` or any private key.**

The Relayer hot key is **not** stored in `.env`, the workspace, or any generated file. GitHub Actions consumes it only at runtime from the repository secret named `RELAYER_PRIVATE_KEY` (Settings → Secrets and variables → Actions). Never paste that value into chat, the editor, or a tracked file. See [`.github/workflows/relayer.yml`](.github/workflows/relayer.yml) (`jobs.runtime` step **Consume RELAYER_PRIVATE_KEY at runtime**). The Tests workflow does not receive this secret. CI defaults to `STUB_RPC=1` (no live RPC, no broadcast). Testnet only: Base Sepolia (`84532`) and Arb Sepolia (`421614`).

| Variable | Purpose |
| --- | --- |
| `PRIVATE_KEY` | Deployer (owner). Must not equal `RELAYER_ADDRESS`. Local demo scripts only. |
| `RELAYER_ADDRESS` | First allowlisted relayer hot key. |
| `RELAYER_PRIVATE_KEY` | **GitHub Actions secret only.** Relayer signer. Injected at runtime; never written to disk. |
| `WETH_ADDRESS` | Required. Set per testnet; no mainnet fallback. |
| `ROUTER_ADDRESS` | Optional post-deploy router allowlist. Root `.env.example` leaves it empty (chain-agnostic). Arb relayer template is the locked router. |
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
src/GasRescueLens.sol              # view helper (wallet / HackQuest evidence)
src/ArbSepoliaDemoPath.sol         # GRTT/gMOCK → WETH pathHash (relayer formula)
src/interfaces/IGasRescueSwap.sol
src/interfaces/IGasRescueSwapViews.sol
src/interfaces/IGasRescueSwapProof.sol  # rescue receipt for registry claims
src/interfaces/IPermit2.sol
src/interfaces/IWETH.sol
src/StrandedRegistry.sol           # Phase-2 scaffold (non-production)
src/interfaces/IStrandedRegistry.sol
src/GasRescue.sol                  # fee-skim harness
src/interfaces/IGasRescue.sol
src/GatedDemoToken.sol             # H1 fixed-supply SDEMO; no mint, no owner
src/mocks/…
test/GasRescueSwap.t.sol
test/GasRescueLens.t.sol
test/fork/                         # live Sepolia smokes; skip if RPC unset
test/GasRescue.t.sol
test/StrandedRegistry.t.sol
test/audit/F5F6Audit.t.sol
script/DeployGasRescueSwap.s.sol
script/DeployGasRescueLens.s.sol   # testnet Lens; Spencer --broadcast only
script/DeployStrandedRegistry.s.sol  # testnet registry; Spencer --broadcast only
script/InspectGasRescueSwap.s.sol  # read-only; no keys
script/HackQuestStatus.s.sol       # Lens consumer; HackQuest JSON; no keys
script/MigrateH1GatedDemoToken.s.sol # H1 simulate-only; Spencer signs; no --broadcast here
script/RescueSwap.s.sol
script/Deploy.s.sol                # harness
script/Rescue.s.sol                # harness
wallet/                            # Vite + React + wagmi/viem (Base + Arb Sepolia)
relayer/                           # Arb Sepolia POST /v1/quotes (Render)
```

## Live (testnet)

**Arb Sepolia is the judged / HackQuest chain.** Base Sepolia is documented and secondary.

**Relayer (Arb Sepolia):** https://stranded-relayer-arb.onrender.com — **KNOW** healthy 2026-09-17 (`ok`, `live`, `stubRpc=false`, chainId `421614`). Hot wallet `0x8240124dc78a27c80354Ca813Df12aa2888A9AF6` holds **0.214961419621579600 ETH** (`cast balance`, 2026-10-01), above the **~0.10 ETH** live-submit floor. `HackQuestStatus` recommends `live-submit-ok-if-user-funded`. A live submit still uses Spencer's keys. The 2026-09-17 reading was ~0.015 ETH. Runtime `RELAYER_PRIVATE_KEY` only (never disk).

**Fee posture (issue #24, Tokenomics MATCH):** keep current Relayer numbers. Service fee is **1% of the tokens being rescued** (`feeAmount = amountIn / 100`). About **20%** is swapped into ETH so the user has gas after (`amountSwap = amountIn / 5` — gas top-up, not a fee). The rest goes to the signed wallet. If the swap would slip more than **1%** (100 bps), the job cancels and nothing moves. USD floor/cap/skip is **deferred** until real USD quotes exist — not a live Relayer bug; do not invent Sepolia prices. Relayer Backend owns any future rewrite. Do not change Relayer fee math from this repo’s Builder lane.

| Chain | GasRescueSwap (judged) | Mock / notes |
| --- | --- | --- |
| Arb Sepolia `421614` | [`0x65e712222745A8FCCbF038A90Fa75caB0867993D`](https://sepolia.arbiscan.io/address/0x65e712222745A8FCCbF038A90Fa75caB0867993D) | Demo **GRTT** `0x5649fF51123D534044aA7E6cBc8762698Ffed713`; also allowlisted gMOCK `0x30006e29a23c713070136F56db1BDf2A8B82B318`; **locked** router [`0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`](https://sepolia.arbiscan.io/address/0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc) (0.0195 ETH); retired open router `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` (delisted Oct 1, 2026, 0 ETH); WETH `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
| Base Sepolia `84532` | [`0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`](https://sepolia.basescan.org/address/0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688) | Mock `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166`; router `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`; WETH `0x4200000000000000000000000000000000000006` |

`GasRescueLens` is **not on-chain** (KNOW). Day-5 `HackQuestStatus` still works without that deploy — it constructs Lens in-script (`lensEphemeral=true`, no broadcast) and prints `hotWalletUnderfunded`, `liveSubmitBlocked`, `recommendedJudgePath`, `judgeNote`, `feePostureNote`, and `liveVsTip`. With the 2026-10-01 hot-wallet balance above 0.10 ETH, the recommended judge path is **`live-submit-ok-if-user-funded`**. Do not list `StrandedRegistry` here (merged Phase-2 scaffold; not judged).

Arb demo path (live Relayer + `ArbSepoliaDemoPath`): `pathHash = keccak256(swapExact(tokenIn, amountSwap, nativeTo))` for GRTT / gMOCK. Wallet fixtures keep placeholder `0xbbb…` and must not be submitted. See [docs/BUILDATHON_PROGRESS.md](docs/BUILDATHON_PROGRESS.md) Day-5. Live QA: [docs/QA_ARB_SEPOLIA_RESCUE.md](docs/QA_ARB_SEPOLIA_RESCUE.md).

**Demo router.** On 2026-10-01 the owner migrated the Arb Sepolia demo router. Retired open router `0x6804…25A8` (delisted Oct 1, 2026) was an unlocked `MockSwapRouter`: anyone could `setPayAmount` and then `swapExact` without tokens and take its ETH (0.0195 ETH inventory, 0.0001 ETH payout, read before the migration). That inventory moved to `LockedDemoSwapRouter` `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc`, which holds 0.0195 ETH. `GasRescueSwap` `allowedRouters` is true for the new router and false for the retired one. `src/LockedDemoSwapRouter.sol` only swaps for the rescue contract, pulls the tokens, pays proportionally, and caps the payout. Owner settings only. Do not `--broadcast` `script/DeployLockedDemoSwapRouter.s.sol` again: the migration already ran, and a second broadcast deploys another router. The Relayer prefers `quote(amountSwap)` and falls back to `payAmount()` when a router has no `quote`. Repo `render.yaml` names the same locked router. The live Render `ROUTER_ADDRESS` on `stranded-relayer-arb` has been `0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc` since Oct 1, 2026, 1:27 PM ET (Relayer Backend deploy), and quotes return that router. Fee math is unchanged (1% fee, ~20% swap slice, 100 bps slip).

Live Arb bytecode **lacks** tip `CANONICAL_PERMIT2()` and `rescueReceipt` — judged v1 `rescueWithPermit` is still OK. Redeploy is Spencer-only: [docs/REDEPLOY-GASRESCUESWAP.md](docs/REDEPLOY-GASRESCUESWAP.md). Permit2 stays **disabled** on both deploys. Owner `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. Demo video: https://youtu.be/GzAfCQwoq88

**H1 (open, not signed).** Live GRTT `0x5649…d713` and gMOCK `0x3000…B318` both expose public `mint` and have no `owner()` or mint gate. A 0-ETH wallet can mint and rescue until `LockedDemoSwapRouter` `0xFE22…f7fc` (0.0195 ETH, `maxPayout` 0.001 ETH) is empty. Relayer limits (1 per wallet and 3 per IP per 4 hours) only slow that. A per-user cap keyed on `swapExact`'s third argument is rejected (M-1): `GasRescueSwap` does not bind that word to the signed user. A global hourly router cap is not on the live router and only slows the drain; do not edit `script/DeployLockedDemoSwapRouter.s.sol` for it. `src/GatedDemoToken.sol` is a fixed-supply EIP-2612 token. Its ERC20 name and permit domain are "Stranded Demo Token" and its symbol is SDEMO; both are immutable. The constructor creates the only 20 SDEMO: 2 to `0x5BFd…BA37` and 18 to `0x3046…bA9D`. There is no `mint` and no owner. `script/MigrateH1GatedDemoToken.s.sol` is simulate-only and keyless (`--sender 0x3046…bA9D`, no `--broadcast` here) and runs in two phases. Phase A deploys SDEMO and allowlists the address from the CREATE receipt. GRTT and gMOCK stay allowlisted, so the live demo keeps working. Phase B delists those two, which are the only tokens on the live allowlist today. GRTT stays drainable between A and B. H1 is open during that window, as it is today, so B should follow within the hour. The ordered steps are in [docs/SDEMO_MIGRATION_RUNBOOK.md](docs/SDEMO_MIGRATION_RUNBOOK.md). Do not change `render.yaml`. Before he signs, `DEMO_TOKEN` stays unset and `HackQuestStatus` still reads live GRTT (`ready: true` for that holder). After Phase A, set `DEMO_TOKEN` on the relayer to the receipt address (`DEMO_TOKEN` wins over `TOKEN_ADDRESS`). `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` is a Render env change on the static site `stranded` plus a rebuild. Do not paste a predicted address. Without that address, a live submit of the new token does not match. The constructor split is the whole supply. Judges receive 2 SDEMO by transfer from the Steward wallet. `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` is Spencer's demo/QA EOA. It was allowlisted as a relayer in the past. On 2026-10-01 `relayers(address)` on `GasRescueSwap` `0x65e7…993D` returned false for it. The live relayer hot key is `0x8240…9AF6`. ETH out is at most SDEMO `totalSupply()` times 0.0005 ETH, so 2 SDEMO = 0.001 ETH and 20 SDEMO = 0.01 ETH, which is 51% of the router's 0.0195 ETH inventory. Remainders are returned and can be swapped again, so the ceiling is the full supply times that rate. The fixture demo (empty Relayer URL) does not use this token.

## Stranded Demo Token (SDEMO)

> **Stranded Demo Token (SDEMO): testnet demo only.** SDEMO is a test token on Arbitrum Sepolia, a test network, at `[address added after deployment]`. It has no monetary value, is not for sale, and cannot be bought from us. It is not an investment and carries no right to profits, revenue, governance, or any future token.
>
> **Fixed supply.** SDEMO has a fixed supply of 20 tokens, all created once when the contract was deployed. No more can ever be minted. 2 SDEMO went to our demo wallet (`0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37`) and 18 to a wallet operated for Steward of the King LLC (`0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`), which sends SDEMO only to demo and hackathon-judge wallets. SDEMO is a standard transferable token, so anyone holding it can send it to any address.
>
> **What SDEMO can draw from the demo router.** The STRANDED rescue flow uses SDEMO to pay out testnet ETH held by the demo router. Every 2 SDEMO can draw up to 0.001 testnet ETH. The full 20 SDEMO supply could draw up to 0.01 testnet ETH. Testnet ETH has no monetary value.
>
> Anyone offering SDEMO for sale, and any "SDEMO" token on another network, is not affiliated with us. STRANDED is experimental, unaudited software provided "as is," without warranties. STRANDED is a project of Steward of the King LLC, an Ohio (USA) limited liability company.

After Phase A, replace `[address added after deployment]` in the disclosure above with the address the CREATE receipt returns. Leave the placeholder until then. Do not paste a nonce-predicted address. The ordered steps are in [docs/SDEMO_MIGRATION_RUNBOOK.md](docs/SDEMO_MIGRATION_RUNBOOK.md).

### Distribution policy

The contract creates 20 SDEMO in the constructor and has no `mint`. Supply stays at `totalSupply()` of 20.

- No faucet and no liquidity pool.
- The Steward wallet transfers 2 SDEMO per named judge or QA wallet, on request only. Those wallets are the demo and hackathon-judge wallets named above.
- Log every transfer (date, recipient, amount, tx hash) in [docs/SDEMO_DISTRIBUTION_LOG.md](docs/SDEMO_DISTRIBUTION_LOG.md). The migration script does not move balances.
- Do not change `setRate` or `setMaxPayout` on the router during judging. Do not call `sweepToken` on SDEMO on the router during judging. SDEMO held by the router is never swept and sent out again. The 0.01 ETH ceiling assumes that.

## Wallet UX

The STRANDED wallet is the Render static site `stranded` (strandedtoken.trade).

Vite + React + wagmi/viem under [`wallet/`](wallet/). Testnets only: Base Sepolia (`84532`) and Arb Sepolia (`421614`). No mainnet.

1. Pick a testnet and connect an injected wallet (switch if the wallet is on the other network).
2. Read the stranded EIP-2612 token balance on that testnet (never invented).
3. Bind a quote: Relayer `POST /v1/quotes` when that chain’s Relayer URL is set; otherwise a labeled dry-mock fixture.
4. Review every required Order field — at least `amountIn`, `amountSwap`, `feeAmount`, `feeTo`, `to`, `nativeTo`, `minAmountOut`.
5. Tap **Confirm details**. Only then: EIP-712 `Order` (domain `StewardGasRescue` / `1`, field `nativeTo` not `safeRecipient`) plus EIP-2612 permit.

See [wallet/README.md](wallet/README.md). Copy `wallet/.env.example` to `wallet/.env`. Leave Relayer URL fields empty for fixtures. Live Arb Relayer origin (document-only; do not commit a filled `.env`): `https://stranded-relayer-arb.onrender.com`. Do not point Base at the Arb Relayer or at a dead/old VPS.

## Phase-2 scaffold: `StrandedRegistry` (non-production)

`src/StrandedRegistry.sol` is a **non-production** find index + bounty layer. It is not the product, is not deployed, and must not go to mainnet.

Security Auditor items on `StrandedRegistry` (H-1, H-2, M-3, M-4, L-4) are fixed on this tree:

1. **Proof gate.** `claimFind(findKey, rescueNonce)` is not permissionless. The caller must be a `GasRescueSwap` allowlisted relayer, and `gasRescueSwap.rescueReceipt(holder, nonce)` must match this find's `token` + `amount` with `relayer == msg.sender`. `find.chainId` must equal `block.chainid`. Bounty is paid to that relayer; callers cannot pick a different rescuer.
2. **Per-find locked bond.** `registerFind` locks `msg.value` in `findBond[findKey]` and `lockedBond[poster]`. `withdrawBond` can take only `posterBond - lockedBond`. Claim pays bounty + refund from that find only.
3. **Bounty is native wei**, capped by the find bond (`bounty <= msg.value`). Not token units.
4. **`receive()` credits** `posterBond[msg.sender]`. **`reclaimExpired`** returns an unclaimed expired find's bond to the poster.

See [docs/STRANDED-REGISTRY.md](docs/STRANDED-REGISTRY.md). Residual follow-ups (not this change): allowlist timelock, MockERC20 permissionless mint, dispute window, same-tx rescue+claim.

## Still out of scope

- Bridge / cross-chain move-out
- Mainnet, token launch, paid firm-audit packaging
- Treating `StrandedRegistry` as production / deploying it

## Appendix: fee-skim harness (`GasRescue`)

Kept compiling so existing tests remain a regression gate. Destination-only skim on **Base Sepolia**: permit-pull `amount`, send `feeAmount` to `feeTo`, return remainder to `user`. Domain name `GasRescue` / version `1`. Same ownership hardening as the product: `Ownable2Step`, `renounceOwnership` disabled. See `test/GasRescue.t.sol` and `script/Deploy.s.sol`.
