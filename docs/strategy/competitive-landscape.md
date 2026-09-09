# Competitive Landscape & Edge Strategy

**Status:** Research snapshot, September 2026. For Buildathon pitch + post-submit roadmap.
**Scope:** Same-chain gas rescue (wallets holding ERC-20s but zero native gas). Not compromised-wallet recovery, not contract-stranded tokens.

---

## 1. Competitor map (direct + adjacent)

### Direct: gasless rescue of *your own* stranded tokens (swap a slice for gas)

| Project | Chain | Mechanism | Edge vs us | Gap we can exploit |
|---|---|---|---|---|
| **RescueETH** (ETHGlobal HackMoney 2026) | Base mainnet | Yellow Network state channels + LI.FI routing; three exits: keep gas, bridge to L1, send to CEX | Stronger gasless infra (Yellow), multi-exit routing, ENS | No Arbitrum; heavier dependency stack; less "rescue dog" brand; no multi-chain discovery index |
| **rescue.eth** (n1shanthb) | Base Sepolia | Same Yellow + LI.FI stack, "Command Center" UI | Polished UI, same primitives | Testnet-only; no mainnet volume; no Arbitrum |
| **Gas Rescue** (Solana, gasrescue.app) | Solana | Relayer pays fee, Jupiter swap for SOL, atomic | Different chain, different asset class (SOL rent/tokens) | Not EVM; no Arbitrum/Base; no multi-chain index |

### Adjacent: stranded *inside contracts* (not wallets)

| Project | Chain | Mechanism | Edge vs us | Gap |
|---|---|---|---|---|
| **Salvage** (2TheMoom) | Ethereum + Base | Scan contracts for mistaken ERC-20 sends, trustless settle, finder fee 7% | Finder-fee + on-chain settlement; Base App Mini App; real mainnet recovery proof | Different problem (contract-stranded, not wallet-gasless); no gas-swap rescue |
| **SALVAGE** (salvagerapp) | Ethereum | Sweep dormant contracts, simulate public functions, pay gas themselves | "We take nothing, we pay the gas" | Different problem; no wallet gasless flow |

### Adjacent: compromised wallets (sweeper bots) — *different problem, but judges may conflate*

| Project | Chain | Mechanism | Edge vs us | Gap |
|---|---|---|---|---|
| **Antidrain** (Zun) | EVM + Solana | EIP-7702 atomic batch, sponsor pays gas, never funds compromised wallet | Atomic, bot-proof, multi-asset (NFT/airdrop/stake) | Requires pasting private key; 20% fee; different threat model |
| **flashrescue.xyz** (frontrunneer) | Ethereum (+L2s) | Flashbots private bundles, Permit2 batch, atomic L2 sweeps | MEV-protected, no % fee on some flows | Ethereum-centric; different problem |
| **Rescue Lifeboat** (KaneMayfield) | Multi-EVM | MEV Blocker private txs, NFT-focused, free/open | Free, open, battle-tested | NFT-only, no fee model, no gas-swap |
| **DrainerLESS**, **Wallet-Rescue-Tool**, **eip7702-asset-rescuer** | Multi-EVM | EIP-7702 delegation rescue | Same primitive family | Crowded, mostly client-side tools |
| **Coinbase Smart Wallet rescue** (stephancill) | Any EVM | Deploy + replay owners, bundler pays gas | Smart-wallet specific | Narrow scope |

### Adjacent: Solana rent reclaim (not EVM gas)

Sol-Incinerator, GetBackSOL, SolRecover, DegenBroom, RefundYourSOL, ChainDust, Overfunded — all close empty SPL accounts to reclaim ~0.002 SOL rent. Fees 1.9–30%. Different chain, different problem.

---

## 2. Honest read: where we stand

- **The swap mechanic is not novel.** RescueETH and rescue.eth already do "swap a slice of USDC for ETH, stay on-chain" via Yellow + LI.FI. Anyone can copy it in a weekend.
- **Our real differentiators today:** Arbitrum Sepolia path, Dalmatian brand, service-fee-only (no token), and a clean, auditable Foundry contract. That's a story + a demo, not a moat.
- **The crowded zone is compromised-wallet rescue (EIP-7702).** Do **not** enter it — it's a different threat model, requires key handling, and is already saturated with free/open tools.
- **The open zone is discovery + multi-chain + non-custodial finder economics.** Nobody indexes *already-stranded* wallet balances across chains and lets a third party earn a bounty for pointing them at a rescue path.

---

## 3. Edge options (ranked for *us*, now)

### A. Keep the wedge, add discovery (recommended, low risk)
Same-chain rescue stays; add an indexer that surfaces wallets holding ERC-20s but zero native gas on supported chains (Arb + Base first). User clicks "rescue" → our flow. This is the natural v1.1 and matches the Phase-2 PRD. Hard part: indexing without false positives; easy part: reuses existing contract.

### B. Multi-exit routing like RescueETH (medium risk)
Add "bridge to L1" and "send to CEX" exits via LI.FI. Increases usefulness, but adds dependency surface and dilutes the simple "carry the rest home" story. Only if judges ask for it.

### C. Permissionless finder bounty on a *known* stranded balance (Phase 2, per PRD)
Register a stranded balance off-chain (EIP-191), first-writer-wins, optional  bounty paid on successful rescue. No custody. This is the harder, more defensible layer — but only after same-chain E2E + volume. Legal/UX around "finder fee" is the real work.

### D. Do NOT: enter EIP-7702 compromised rescue, Solana rent, or contract-stranded (Salvage's lane). Different buyers, different stacks, zero leverage from GasRescueSwap.

---

## 4. One-line pitch for judges

> "Everyone's building gasless rescue primitives. We're building the **search market** on top — find stranded balances, earn a bounty, rescue without custody. Same dog, bigger yard."

---

*Last updated: 2026-09-09. Revisit after Buildathon submit.*
