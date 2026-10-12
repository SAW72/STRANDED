# STRANDED Points Program

**Status:** Draft. Points are off-chain scores and are unpaid. No rewards are promised.

## Purpose

Record genuine testnet activity as an off-chain score. Points measure usage. They are not a payment and they are not transferable.

## Design principles

1. **Post-facto only.** Points are recorded for activity that already happened. Nothing in the activity phase says that using the product will be paid.
2. **No consideration.** No purchase, no referral, and no holding requirement. Points come from using the product.
3. **No cash value.** Scores are not shown with a price, and scoring does not use one.
4. **Verifiable.** Every on-chain action carries its transaction hash so the ledger can be checked against Arbitrum Sepolia.

## Scoring rubric

| Action | Points | Notes |
|---|---|---|
| Rescue completed (GasRescue) | 100 | Flat placeholder, pending Spencer's decision. Not based on a price or an amount rescued. |
| Relayer job executed | 50 | Registered operator identity required |
| Registry find posted (StrandedRegistry) | 30 | Find must be a real stranded balance |
| Registry find claimed | 50 | Claim must succeed on-chain |
| Active wallet session | 10 per week | One session per wallet per week |
| Bug report / security finding | 100–500 by severity | Must include a tx hash or reproducible steps |

Severity bands in code: low 100, medium 200, high 300, critical 500. Critical is also the maximum stored on one ledger row.

## Anti-gaming

- One rescue scores the flat 100 once. Splitting it across wallets does not multiply points.
- One wallet session per wallet per ISO week.
- No referral bonuses.
- No points for holding or transferring a balance.
- Bug reports require a transaction hash or reproducible steps.
- Relayer jobs require a registered operator identity.
- A single ledger row cannot exceed 500 points.

## Ledger

- Append-only SQLite table keyed by wallet address. A later replacement could be Postgres. No connection string lives in this repo.
- Unique constraint on (wallet, action, tx_hash) prevents double-counting the same event for the same wallet.
- Append-only is enforced only through the app and the database triggers. `UPDATE` and `DELETE` raise `append-only`. A repeated insert raises `duplicate`.
- A raw `ON CONFLICT DO NOTHING` raises `duplicate`, because the BEFORE INSERT trigger aborts before SQLite can skip the row.
- `syntheticTxKey` lowercases its inputs before hashing off-chain keys.
- `tx_hash` is `NOT NULL`. Off-chain actions store a synthetic key.
- `created_at` is set by the server. A caller-supplied timestamp is ignored.
- Rows for on-chain actions store the transaction hash for independent verification.
- Dashboard is read-only: enter a wallet address, see points by category and rank. No login, no connect-wallet button, no sign-up.

## Not planned

Not planned. Points have no cash or token value.

There is no launch, airdrop, conversion rate, or cash redemption in this program. Snapshot trees, on-chain claims, and allocation tables are not part of the ledger.
