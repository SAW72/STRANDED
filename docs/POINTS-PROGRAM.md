# STRANDED Points Program

**Status:** Draft. Points are off-chain scores and are unpaid. No rewards are offered.

Points are an off-chain record of activity only. They are not a token, have no cash value, can't be sold, transferred or redeemed, may be adjusted or cancelled at any time, and do not convert to anything. No token, airdrop, conversion, snapshot or claim is planned.

## Purpose

Record genuine testnet activity as an off-chain score. Points measure usage. They are not a payment and they are not transferable.

## Design principles

1. **Recorded after the fact.** Points record activity that already happened. Using the product is not paid.
2. **Nothing to buy.** No purchase, referral or holding requirement. Points come from using the product.
3. **No cash value.** Scores are not shown with a price, and scoring does not use one.
4. **Verifiable.** Every on-chain action carries its transaction hash so the ledger can be checked against Arbitrum Sepolia.

## Scoring rubric

| Action | Points | Notes |
|---|---|---|
| Rescue completed (GasRescue) | Flat placeholder number. Not based on a price or an amount rescued. Point weights are placeholders and may change. | Not based on a price or an amount rescued. |
| Relayer job executed | 50 | Reviewers check for a registered operator identity before points are recorded. |
| Registry find posted (StrandedRegistry) | 30 | Reviewers check that the find is a real stranded balance before points are recorded. |
| Registry find claimed | 50 | Reviewers check that the claim succeeded on-chain before points are recorded. |
| Active wallet session | 10 per week | One session per wallet per ISO week. The week is the server clock. |
| Security report | No points | Security reports go through the security policy and carry no points. |

## Anti-gaming

- One verified rescue is scored once. A second wallet cannot record the same rescue transaction.
- One wallet session per wallet per ISO week. The week is the server clock; a caller-supplied time is ignored.
- No referral bonuses.
- No points for holding or transferring a balance.
- Security reports go through the security policy and carry no points.
- Relayer jobs require a registered operator identity.

## Ledger

- Append-only SQLite table keyed by wallet address. A later replacement could be Postgres. No connection string lives in this repo.
- On-chain rows are unique on (action, tx_hash), so a second wallet cannot record the same transaction for that action. Other off-chain rows stay unique on (wallet, action, tx_hash).
- Old bug-report and security rows (`bug_report`, `security`, `security_finding`, and `finding`) are kept and hidden. Database triggers block new ones, and the read path excludes them. Nothing is deleted.
- Append-only is enforced only through the app and the database triggers. `UPDATE` and `DELETE` raise `append-only`. A repeated insert raises `duplicate`.
- A raw `ON CONFLICT DO NOTHING` raises `duplicate`, because the BEFORE INSERT trigger aborts before SQLite can skip the row.
- `syntheticTxKey` lowercases its inputs before hashing off-chain keys.
- `tx_hash` is `NOT NULL`. Off-chain actions store a synthetic key.
- `created_at` is set by the server. A caller-supplied timestamp is ignored.
- Rows for on-chain actions store the transaction hash for independent verification.
- Dashboard is read-only: enter a wallet address, see recorded activity by category. No login, no connect-wallet button, no sign-up.

## What points are not

Points have no cash or token value. There is no launch, airdrop, conversion rate or cash redemption in this program. Snapshot trees, on-chain claims, and allocation tables are not part of the ledger.
