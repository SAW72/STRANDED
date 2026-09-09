# StrandedRegistry — Phase 2 Thin Registry (v1.2)

**Status:** Scaffolded 2026-09-09. Testnet only. Do **not** deploy to mainnet.
**Depends on:** GasRescueSwap v1 live + E2E green on Arb Sepolia.
**Owner:** Spencer. Docs: Ara.

---

## What this is

A permissionless index where anyone can **register a known stranded ERC-20 balance** (holder has tokens, zero native gas), attach an optional bounty, and a rescuer claims the find, runs the existing GasRescueSwap rescue, and earns a finder's fee.

No custody of user funds. No token. Service-fee + bounty only. Same dog, bigger yard.

## Actors

| Actor | Role |
| --- | --- |
| **Poster** | Discovers a stranded balance, registers it with a bond + optional bounty. |
| **Rescuer** | Claims the find, executes GasRescueSwap, earns finder fee (5%, cap 10%). |
| **Holder** | The stranded wallet owner — gets the remainder home. |
| **Owner** | Sets fee %, min bond, pause. `Ownable2Step`; renounce disabled. |

## Flow

1. Poster calls `registerFind(holder, token, amount, bounty, chainId, deadline)` with `msg.value >= minBond`.
2. `findKey = keccak256(poster, holder, token, chainId, nonce)` — first writer wins.
3. Rescuer (or anyone) calls `claimFind(findKey, rescuer)` after the rescue settles.
4. Contract pays bounty (if any) from poster's bond to rescuer; refunds poster's bond; emits `FindClaimed`.
5. Finder fee (5% of rescued value) is recorded for off-chain settlement or future on-chain pull.

## Hard problems (still open)

- **Proof of ownership:** poster could register a fake balance. Mitigation: bond + dispute window (deferred).
- **Spam:** rate limit + bond (in). Automated filtering (deferred).
- **Finder-fee legality:** service-fee framing; consult counsel before mainnet.
- **Griefing:** poster registers, never funds bounty — bounty is optional.

## Non-goals

- Global multi-chain oracle.
- More than Arb + Base.
- Compromised-wallet rescue.
- Token launch.

## Tests

`forge test --match-contract StrandedRegistryTest`

Happy path, wrong-chain revert, low-bond revert, double-claim revert, expiry revert, fee cap, pause.

---

*Scaffolded by Ara. Parked from mainnet until v1 E2E + Buildathon submit.*
