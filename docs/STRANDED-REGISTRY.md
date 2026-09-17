# StrandedRegistry — Phase 2 Thin Registry (v1.3)

**Status:** Non-production scaffold. Testnet only. Do **not** deploy to mainnet.
**Auditor gate (this revision):** H-1, H-2, M-3, M-4, L-4 addressed on `StrandedRegistry` only. GasRescueSwap / Lens unchanged.
**Depends on:** GasRescueSwap v1 live + E2E green on Arb Sepolia.
**Owner:** Spencer. Docs: Ara.

---

## What this is

A permissionless **index** where anyone can **register a known stranded ERC-20 balance** (holder has tokens, zero native gas) and attach an optional **native-wei** bounty. Claims are **not** permissionless.

A GasRescueSwap allowlisted relayer executes the existing rescue, then claims the find with the on-chain rescue receipt. The bounty is paid to that relayer from that find's locked ETH bond. No custody of user funds. No token.

This remains a **scaffold** until a firm audit / mainnet gate.

## Actors

| Actor | Role |
| --- | --- |
| **Poster** | Discovers a stranded balance, registers it with a per-find bond + optional native bounty. |
| **Relayer / rescuer** | Allowlisted on `GasRescueSwap`. Executes the rescue, then claims the find. Earns bounty (native wei, from this find's bond) + recorded finder fee (5% of *token* amount, cap 10%, event-only). |
| **Holder** | The stranded wallet owner — gets the remainder home via GasRescueSwap. |
| **Owner** | Sets fee %, min bond, pause. `Ownable2Step`; renounce disabled. |

## Claim proof

`claimFind(findKey, rescueNonce)` requires:

1. `find.chainId == block.chainid` (L-4).
2. `msg.sender` is `gasRescueSwap.relayers(msg.sender)`.
3. `rescueReceipt(find.holder, rescueNonce)` exists and equals `{ token: find.token, amountIn: find.amount, relayer: msg.sender }`.
4. That receipt has not already settled another find (`usedRescueProof`).
5. `block.timestamp <= find.deadline`.

Bounty is paid to `msg.sender`. There is no `rescuer` argument.

Exact `amountIn == find.amount` is required. Partial rescues do not claim (follow-up).

`registerFind` also requires `chainId` to be an allowed testnet **and** equal to `block.chainid`, so a Base find cannot be posted on the Arb deployment.

## Bond accounting (H-1)

`registerFind` credits `posterBond[poster]`, increments `lockedBond[poster]`, and sets `findBond[findKey] = msg.value`.

```
availableBond(poster) = posterBond[poster] - lockedBond[poster]
```

`withdrawBond` pays only `availableBond`. Active find locks cannot be withdrawn. That keeps `claimFind` solvent: the ETH for bounty + leftover refund stays in the contract until claim or reclaim.

On a valid claim the contract pays bounty (if any) and refunds the leftover **from that find's bond only**, then drops that amount from `lockedBond` and `posterBond`. Other finds and unused `depositBond` / `receive` balances stay.

## Bounty denomination (H-2)

`Find.bounty` is **native wei**, funded by the find's ETH bond.

- Register reverts if `bounty > msg.value` (`BountyTooHigh`). A poster may offer up to 100% of the bond.
- Claim pays `f.bounty` wei to the relayer and `findBond - bounty` wei back to the poster.
- The old `bounty <= amount / 10` check compared wei to token units and is removed. That check rejected honest wei bounties and allowed token-unit figures to be paid as dust wei.

`finderFeeBps` is still a **token-unit** record on `FindClaimed` for off-chain settlement. It is never transferred as ETH.

## Receive (M-3)

`receive()` credits `posterBond[msg.sender]` and emits `BondDeposited`. Naked ETH is not left unaccounted. The credit is unlocked (`lockedBond` unchanged) and can be withdrawn. `receive` is not `nonReentrant` so a refund recipient that forwards value back cannot brick `claimFind` / `withdrawBond`.

## Expired reclaim (M-4)

`reclaimExpired(findKey)` — **poster only**, any pause state:

1. Find exists, caller is `find.poster`, not yet claimed, `find.chainId == block.chainid`, `block.timestamp > deadline`.
2. Clears `findBond`, marks `claimed`, releases the lock, refunds the full find bond to the poster.
3. A later `claimFind` reverts `AlreadyClaimed`. The receipt is not consumed, so it cannot settle this find and remains unused for any other matching find.

Expired finds stay locked against `withdrawBond` until this path runs. That keeps accounting explicit: unlock happens in one function with the claimed-terminal flag.

## Flow

1. Poster calls `registerFind(holder, token, amount, bountyWei, chainId, deadline)` with `msg.value >= minBond` and `bountyWei <= msg.value`.
2. `findKey = keccak256(poster, holder, token, chainId, nonce)` — first writer wins. Bond is stored per-find and locked.
3. Allowlisted relayer executes `GasRescueSwap.rescueWithPermit` / `rescueWithPermit2` for that holder / token / amount. The swap writes `rescueReceipt[holder][nonce]`.
4. That same relayer calls `claimFind(findKey, rescueNonce)` on the same chain.
5. Contract pays bounty from `findBond[findKey]` to the relayer; refunds the leftover find bond to the poster; emits `FindClaimed`. Other finds are untouched.
6. If the deadline passes unclaimed, the poster calls `reclaimExpired`.

## Hard problems (still open)

- **Proof of ownership:** poster could register a fake balance. Mitigation: bond + dispute window (deferred).
- **Spam:** rate limit + bond (in). Automated filtering (deferred).
- **Finder-fee legality:** service-fee framing; consult counsel before mainnet.
- **Griefing:** poster registers, never funds bounty — bounty is optional.
- **Same-tx rescue+claim:** still two transactions.
- **Ops (not this PR):** multi-relayer; Permit2 preference / allowance-skip for permit grief.

## Non-goals

- Global multi-chain oracle.
- More than Arb + Base.
- Compromised-wallet rescue.
- Token launch.
- Mainnet deploy.

## Deploy (testnet only)

`script/DeployStrandedRegistry.s.sol` mirrors `DeployGasRescueSwap` hygiene:

- Refuses every chain except Base Sepolia 84532 and Arb Sepolia 421614
- `PRIVATE_KEY` + `GAS_RESCUE_SWAP` from env only (no committed / test keys, no hardcoded swap)
- Rejects zero addresses
- Logs `StrandedRegistry`, owner, and bound swap
- Constructor: `StrandedRegistry(initialOwner = deployer, gasRescueSwap_)`

Broadcast is Spencer keys only. Agents must never pass `--broadcast`. Mainnet remains rejected.

## Tests

`forge test --match-contract StrandedRegistryTest`

Happy path, wrong-chain / other-testnet revert, low-bond revert, authorized claim, stranger cannot claim, missing/mismatched receipt, other-relayer cannot steal, per-find bond isolation, one receipt cannot settle two finds, double-claim, expiry, fee cap, pause.

Auditor IDs:

| ID | Test |
| --- | --- |
| H-1 | `test_H1_withdrawBond_revertsWhenFindBondLocked`, `test_H1_withdrawBond_allowsUnusedDeposit_claimStaysSolvent` |
| H-2 | `test_H2_bountyIsNativeWei_notCappedByTokenAmount`, `test_H2_bountyGreaterThanBondReverts`, `test_H2_fullBondBountyIsSolvent` |
| M-3 | `test_M3_receiveCreditsPosterBond`, `test_M3_receiveDoesNotUnlockFindBond` |
| M-4 | `test_M4_reclaimExpired_*` |
| L-4 | `test_L4_claimFind_requiresChainIdMatch` |
| Deploy (9) | `test_deployScript_refusesMainnet`, `test_deployScript_envHygiene_rejectsZeroAndDeploys` |

---

*Scaffolded by Ara. Auditor H-1 / H-2 / M-3 / M-4 / L-4 closed on this revision. Parked from mainnet until v1 E2E + firm audit.*
