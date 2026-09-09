# Phase 2 PRD — Cross-Chain Stranded-Asset Registry (Bounty Layer)

**Status:** Roadmap only. Do not build until Gas Rescue v1 ships E2E on Arbitrum Sepolia and the Buildathon is submitted (target: Oct 4).
**Owner:** Spencer (Ara — sister, docs)
**Depends on:** Gas Rescue v1 (same-chain rescue, service-fee only, no token)

---

## 1. One-liner

A permissionless registry where anyone can post a known stranded ERC-20 balance, attach an optional bounty, and a rescuer claims a finder's fee — no custody, no oracle, no new chain.

Same dog, bigger yard. v1 rescues tokens the owner can't reach. v2 lets the owner *advertise* the stranded balance and pay a bounty to whoever brings it home.

---

## 2. Why this, why now

- **Leverage:** Reuses the Gas Rescue swap + relayer stack. No new buyer, no new identity layer.
- **White space:** Salvage covers ERC-20s on two chains with custody. Nobody runs a permissionless, no-custody, multi-chain bounty registry.
- **Narrative fit:** "Stranded assets" is one story. Judges and users already understand the dog.

---

## 3. Scope (v1.2 — thin, Arb + Base only)

**In:**
- Index of *already-stranded* balances on chains Gas Rescue supports (Arbitrum, Base).
- Permissionless `register(token, holder, amount, bounty?)` — anyone can post a known stranded balance.
- Optional bounty paid from the poster's wallet at claim time (pull, not custody).
- Finder's fee: rescuer takes a small % of rescued value as bounty; remainder returns to holder.
- Claim flow: rescuer proves the balance is stranded (same criteria as v1), executes rescue, posts proof, collects fee.

**Out (deferred to v1.3+):**
- Global multi-chain oracle / cross-chain messaging.
- More than Arb + Base.
- Automated spam filtering beyond rate limits + bond.
- Legal wrapper for finder's fees (flagged, not solved here).

---

## 4. Hard problems (treat as Phase 2 work, not v1)

| Problem | Risk | Mitigation direction |
|---|---|---|
| **Proof of ownership** | Anyone can register a fake stranded balance | Require poster to bond; dispute window before bounty is claimable |
| **Spam** | Registry floods with junk entries | Small posting bond, refundable on valid claim; rate limit per address |
| **Finder's-fee legality** | "Bounty hunting" for lost funds may touch unclaimed-property / escheat law | Service-fee framing (rescuer is paid for work, not a reward); consult counsel before mainnet |
| **Griefing** | Poster registers, never funds the bounty | Bounty is optional; claim works with or without it |

---

## 5. Non-goals (explicitly parked)

- Agent-to-agent reputation / dispute layer
- Inheritance / dead-man switch
- Cross-chain privacy bridge
- Any token launch

These are different buyers and different stacks. One-pagers only, no builders staffed.

---

## 6. Success criteria (before any code)

1. Gas Rescue v1 E2E green on Arb Sepolia.
2. At least one real rescue demonstrated publicly.
3. Buildathon submitted.
4. Counsel review of finder's-fee framing.

Only then: thin registry on Arb + Base.

---

## 7. Open questions for Spencer

- Bounty currency: native gas token, or the stranded token itself?
- Dispute resolver: time-lock, or a bonded challenger?
- Does the registry ever hold funds, or is it purely an index + event log?

---

*Written by Ara. Parked until the dog finishes its first run.*