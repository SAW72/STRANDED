# Gas Rescue — Buildathon Pitch (Why Us)

**One-liner:** Gas Rescue is the Dalmatian that finds wallets holding tokens but zero ETH, swaps a small slice for gas, and carries the rest home — live on Arbitrum Sepolia, service-fee only, no token.

## The problem (real, measurable)
Millions in ERC-20s sit stranded on L2s because the wallet has tokens but no native gas. The user is stuck in a "need gas to get gas" loop. Existing tools either wait for the user to show up, or only handle tokens trapped *inside* contracts.

## Competitors (what they do, where they stop)

| Project | What it does | Gap we exploit |
|---|---|---|
| **RescueETH** (HackMoney 2026, Base) | Gasless "Get Gas & Stay" via Yellow Network + LI.FI; also bridge-to-L1 / send-to-CEX | Reactive only — user must connect and ask. No discovery, no bounty. |
| **rescue.eth** (Base Sepolia) | Same Yellow + LI.FI stack, polished "Command Center" UI | Same reactive model; no multi-chain index, no finder incentive. |
| **Salvage** (Ethereum + Base) | Scans contracts for *tokens sent to the wrong address*, finder fee 7% | Different problem (contract-trapped), not wallet-stranded. Finder model exists but scoped to contracts. |
| **SALVAGE** (dormant-contract sweeper) | Triggers public recovery functions on dead contracts, pays gas itself | Contract-side only; no wallet gas-rescue. |
| **GetBackMyCrypto** | Recovers *stuck L2 bridge withdrawals* across 10 chains, 10% fee | Bridge-withdrawal specific, not general stranded-wallet rescue. |
| **flashrescue.xyz / FlashRescue** | Compromised-wallet sweeps via Flashbots bundles | Different threat model (hacked keys); crowded, legal-heavy. |
| **DrainerLESS / EIP-7702 rescuers** | Client-side rescue from compromised wallets using EIP-7702 delegation | Hacked-wallet lane; key handling, sweeper-bot races. |
| **Rescue Wallet** (Chrome ext) | Recovery-focused extension, gas handled by the extension | Compromised/risky wallet migration, not stranded-but-owned. |

**Shared blind spot across all of them:** nobody *indexes already-stranded wallets across chains and lets a third party earn for pointing them at a rescue path.* Every tool is pull, not push.

## Our edge (the harder layer)
1. **Discovery first.** Index wallets that already hold stranded balances (tokens, zero gas) on supported chains. Surface them — the user doesn't have to know they need help.
2. **Finder bounty (Phase 2).** Permissionless tip jar on a *known* stranded balance: anyone can register a find, earn a cut when the rescue settles. No custody, no token, service-fee only.
3. **Same-chain rescue that just works.** Swap a slice for gas, keep the rest — the Dalmatian mechanic, proven on Arbitrum Sepolia. Competitors copy the swap; we own the *find-and-rescue* loop.
4. **Clean lane.** Stranded-but-owned wallets only. We explicitly do **not** touch compromised-wallet rescue (flashrescue, DrainerLESS) — different threat model, different legal surface, judges will lump us together if we blur it.

## What we are *not* claiming
- Not the first gas-rescue swap (RescueETH/rescue.eth exist).
- Not a privacy bridge, not agent reputation, not inheritance. Those are parked.
- Not a token. Service fee only, forever for v1.

## The ask
Ship the clearest, most lovable version of stranded-wallet rescue before Oct 4. Discovery + bounty is the sequel that makes us the category, not another entrant.

*Dalmatian finds it. Dalmatian carries it home.*