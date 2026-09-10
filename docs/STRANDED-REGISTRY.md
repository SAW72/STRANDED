# StrandedRegistry — Phase 2 Thin Registry (v1.2)

**Status:** Non-production scaffold. Testnet only. Do **not** deploy to mainnet.
**HIGHs (claimFind):** Fixed — proof-gated against a completed GasRescueSwap rescue receipt; bond accounting is per-find.
**Depends on:** GasRescueSwap v1 live + E2E green on Arb Sepolia.
**Owner:** Spencer. Docs: Ara.

---

## What this is

A permissionless **index** where anyone can **register a known stranded ERC-20 balance** (holder has tokens, zero native gas) and attach an optional bounty. Claims are **not** permissionless.

A GasRescueSwap allowlisted relayer executes the existing rescue, then claims the find with the on-chain rescue receipt. The bounty is paid to that relayer. No custody of user funds. No token. Service-fee + bounty only. Same dog, bigger yard.

This remains a **scaffold** until a firm audit / mainnet gate. The Security Auditor HIGHs on `claimFind` are closed on this revision.

## Actors

| Actor | Role |
| --- | --- |
| **Poster** | Discovers a stranded balance, registers it with a per-find bond + optional bounty. |
| **Relayer / rescuer** | Allowlisted on `GasRescueSwap`. Executes the rescue, then claims the find. Earns bounty (native, from this find's bond) + recorded finder fee (5%, cap 10%). |
| **Holder** | The stranded wallet owner — gets the remainder home via GasRescueSwap. |
| **Owner** | Sets fee %, min bond, pause. `Ownable2Step`; renounce disabled. |

## Claim proof (HIGH-1)

`claimFind` used to be callable by anyone, who also chose `rescuer`. That is bounty theft.

**Pattern (fits the existing relayer design):** `GasRescueSwap` writes a `RescueReceipt { tokenIn, amountIn, relayer }` keyed by `(user, nonce)` when a rescue succeeds (`IGasRescueSwapProof`). `usedNonces` alone is not a claim proof — it does not bind token, amount, or which relayer ran the job.

`claimFind(findKey, rescueNonce)` then requires:

1. `msg.sender` is `gasRescueSwap.relayers(msg.sender)`.
2. `rescueReceipt(find.holder, rescueNonce)` exists and equals `{ token: find.token, amountIn: find.amount, relayer: msg.sender }`.
3. That receipt has not already settled another find (`usedRescueProof`).

Bounty is paid to `msg.sender`. There is no `rescuer` argument. A stranger, or a different allowlisted relayer, cannot steal the bounty. The rescue itself stays a separate tx (registry stays thin).

Exact `amountIn == find.amount` is required. Partial rescues do not claim (follow-up).

## Bond accounting (HIGH-2)

`registerFind` credits `posterBond[poster]` **and** locks `findBond[findKey] = msg.value`.

On a valid claim the contract pays bounty (if any) and refunds the leftover **from that find's bond only**. Other finds and unused `depositBond` balances are not zeroed.

## Flow

1. Poster calls `registerFind(holder, token, amount, bounty, chainId, deadline)` with `msg.value >= minBond`.
2. `findKey = keccak256(poster, holder, token, chainId, nonce)` — first writer wins. Bond is stored per-find.
3. Allowlisted relayer executes `GasRescueSwap.rescueWithPermit` / `rescueWithPermit2` for that holder / token / amount. The swap writes `rescueReceipt[holder][nonce]`.
4. That same relayer calls `claimFind(findKey, rescueNonce)`.
5. Contract pays bounty from `findBond[findKey]` to the relayer; refunds the leftover find bond to the poster; emits `FindClaimed`. Other finds are untouched.
6. Finder fee (5% of rescued value) is recorded for off-chain settlement or future on-chain pull.

## Hard problems (still open)

- **Proof of ownership:** poster could register a fake balance. Mitigation: bond + dispute window (deferred).
- **Spam:** rate limit + bond (in). Automated filtering (deferred).
- **Finder-fee legality:** service-fee framing; consult counsel before mainnet.
- **Griefing:** poster registers, never funds bounty — bounty is optional.
- **Bounty denomination:** bounty is stored in token units but paid in native wei from the find bond (scaffold quirk).
- **Expired-find reclaim:** an unclaimed expired find still holds `findBond` until a later reclaim path (deferred).
- **Same-tx rescue+claim:** still two transactions.

## Non-goals

- Global multi-chain oracle.
- More than Arb + Base.
- Compromised-wallet rescue.
- Token launch.
- Mainnet deploy.

## Tests

`forge test --match-contract StrandedRegistryTest`

Happy path, wrong-chain revert, low-bond revert, authorized claim, stranger cannot claim, missing/mismatched receipt, other-relayer cannot steal, per-find bond isolation, one receipt cannot settle two finds, double-claim, expiry, fee cap, pause.

---

*Scaffolded by Ara. HIGH claimFind fixes: proof gate + per-find bond. Parked from mainnet until v1 E2E + firm audit.*
