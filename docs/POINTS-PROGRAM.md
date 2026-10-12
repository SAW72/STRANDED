# STRANDED Points Program

**Status:** Draft — not yet announced. No token exists. No rewards are promised.

## Purpose

Track genuine testnet activity so that, if a token ever launches, early contributors can be recognized. Points are off-chain scores only. They are not tokens, not securities, and not a promise of future value.

## Design principles

1. **Post-facto only.** Points are recorded for activity that already happened. Nothing is announced during the activity phase that says "use this and you will be rewarded."
2. **No consideration.** No purchase, no referral, no holding requirement. Points come from using the product.
3. **No token during points phase.** No testnet token is minted. No dollar values are shown anywhere.
4. **Conversion rate set at TGE, never before.** The points-to-token rate is decided only after the snapshot, so it cannot be gamed.
5. **Verifiable.** Every on-chain action carries its transaction hash so the ledger can be checked against Arbitrum Sepolia.

## Scoring rubric

| Action | Points | Notes |
|---|---|---|
| Rescue completed (GasRescue) | 100 + 1 per $1 of token value rescued | Core user signal |
| Relayer job executed | 50 | Registered operator identity required |
| Registry find posted (StrandedRegistry) | 30 | Find must be a real stranded balance |
| Registry find claimed | 50 | Claim must succeed on-chain |
| Active wallet session | 10 per week | One session per wallet per week |
| Bug report / security finding | 100–500 by severity | Must include tx hash or reproducible steps |

## Anti-gaming

- One rescue = 100 points regardless of wallet count. Splitting across wallets does not multiply rewards.
- No referral bonuses.
- No points for holding or transferring tokens (no token exists anyway).
- Bug bounties require a verified finding with a transaction hash or reproducible steps.
- Relayer jobs require a registered operator identity.

## Ledger

- Append-only PostgreSQL table keyed by wallet address.
- Unique constraint on (wallet, action, tx_hash) prevents double-counting.
- Rows for on-chain actions store the transaction hash for independent verification.
- Dashboard is read-only: enter a wallet address, see points by category and rank. No login, no connect-wallet button, no sign-up.

## Snapshot and freeze

1. Announce freeze date 14 days in advance.
2. Stop accepting writes at T-zero.
3. Build a Merkle tree over (wallet, total_points) pairs; publish the root on-chain.
4. Users claim with a Merkle proof plus a wallet signature.
5. Unclaimed points after 90 days flow to a community treasury, not the team.

## Conversion (illustrative only — rate set at TGE)

Example: 5% of a 100M token supply = 5M tokens for points.
- 2M points earned → 2.5 tokens/point
- 5M points earned → 1 token/point
- 10M points earned → 0.5 tokens/point

## Allocation (illustrative)

- Team & investors: 20% (4-year vest, 1-year cliff)
- Treasury: 25%
- Liquidity: 10%
- Public sale: 15%
- Points: 5%
- Unallocated (future incentives): 25%

## Legal note

This structure follows the SEC/CFTC March 2026 joint interpretation guidance on airdrops. It is an interpretation, not a statute, and does not bind a court. A securities lawyer should review before any public announcement or token launch.
