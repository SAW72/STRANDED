# GasRescue — Niche & Competitive Notes

Captured: 2026-09-03 (Thursday). For later — do not act on until the first live rescue works end-to-end and the breaker bot finishes reentrancy.

## The problem (real, crowded)
Wallets full of tokens but zero ETH for gas. Stranded users can't move their own assets.

## Who's already there
- **Rescue.eth** (Base Sepolia) — gasless recovery via Yellow Network state channels + LI.FI routing. User signs a permit; network swaps a slice of tokens for ETH; no gas needed.
- **RescueETH** — HackMoney hackathon project, same gasless-rescue idea.
- **Salvage** — tokens stuck inside contracts.
- **Gate Layer / MetaMask** — gas-free swaps baked into chain and wallet (7702).
- **DrainerLESS** — EIP-7702 delegation, client-side, no third party.

The "swap tokens for gas" idea is taken. The dedicated-Relayer angle is not.

## Our angle: non-custodial Relayer
A dedicated Relayer that pays gas outright and takes a fee, instead of routing through state channels or account abstraction.

- Simpler to reason about and audit.
- Works for any stranded wallet — not just ones that can sign a Yellow permit.
- Tradeoff: someone funds the Relayer, and users must trust it won't run away with tokens.

## How to beat them (three things)
1. **Fee transparency** — show the exact fee and destination before the user signs, every time. Most projects bury it.
2. **Atomicity** — the rescue either fully succeeds or fully reverts. No partial drains.
3. **No custody** — the Relayer never holds the user's tokens, only pays gas. That's the trust story against the Yellow/LI.FI crowd.

## The real risk
Not that someone already did it — it's that paymasters and 7702 make the whole problem smaller over time. Window is roughly the next year or two while wallets still ship users with empty gas tanks.

## Decision rule
Finish the first live rescue. See if it works end-to-end. Then decide if it's worth more spend. Do not write this into the builder's brief until then.
