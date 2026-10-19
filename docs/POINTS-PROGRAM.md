# STRANDED Points Program

**Status:** Draft. Points are off-chain scores and are unpaid. No rewards are offered.

Points are an off-chain record of activity only. They are not a token, have no cash value, can't be sold, transferred or redeemed, may be adjusted or cancelled at any time, and do not convert to anything. No token, airdrop, conversion, snapshot or claim is planned.

## Counsel review

**Do not publish until reviewed by counsel.** The public points announcement needs Lawyer review before it goes out. No public points announcement goes out until all of the following are done:

(a) Lawyer reviews the exact final text for every channel, plus a screenshot of the live /points page.

(b) The full POINTS_DISCLAIMER, or a link to it, sits next to any points mention.

(c) Banned words and phrases: airdrop; token (except 'not a token'); reward/earn; value; early/early-adopter; 'points may matter later'; conversion; snapshot; eligibility; leaderboard-for-prizes; and any hint of a future distribution.

(d) Spencer gives an explicit GO after Lawyer's sign-off.

The strandedtoken.trade domain must never be paired with points wording in announcements.

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
| Rescue completed (GasRescue) | Flat placeholder number. Not based on a price or an amount rescued. Point weights are placeholders and may change. | - |
| Relayer job executed | 50 | The ledger does not verify this itself. It accepts a non-empty operatorId and a transaction hash of the form 0x plus 64 hex characters. |
| Registry find posted (StrandedRegistry) | 30 | The ledger does not verify this itself. It accepts a transaction hash of the form 0x plus 64 hex characters. |
| Registry find claimed | 50 | The ledger does not verify this itself. It accepts a transaction hash of the form 0x plus 64 hex characters. |
| Active wallet session | 10 per week | One session per wallet per ISO week. The week is the server clock. |
| Security report | No points | Security reports go through the security policy and carry no points. |

## Anti-gaming

- One rescue transaction is scored once. A second wallet cannot record the same rescue transaction.
- One wallet session per wallet per ISO week. The week is the server clock; a caller-supplied time is ignored.
- No referral bonuses.
- No points for holding or transferring a balance.
- Security reports go through the security policy and carry no points.
- The ledger does not verify this itself. A relayer job needs a non-empty operatorId.

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
