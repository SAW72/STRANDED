# Buildathon Update — StrandedRegistry Scaffolded

**Date:** 2026-09-09 (scaffold) / 2026-09-10 (claimFind HIGH fixes)
**Status:** Non-production scaffold. Code + tests + docs. Not deployed. Not competing with Sep 13–Oct 4 sprint.

## What landed

- `src/StrandedRegistry.sol` — find registry + finder bounty, Arb + Base Sepolia only.
- `src/interfaces/IStrandedRegistry.sol`
- `src/interfaces/IGasRescueSwapProof.sol` — on-chain rescue receipt consumed by `claimFind`.
- `test/StrandedRegistry.t.sol` — register, chain guard, bond, authorized claim, stranger cannot claim, receipt mismatch, per-find bond, double-claim, expiry, fee cap, pause.
- `docs/STRANDED-REGISTRY.md` — design + open problems.

## Security Auditor HIGH fixes (2026-09-10)

1. **`claimFind` is no longer permissionless.** It requires a completed `GasRescueSwap` rescue receipt bound to the find (holder, token, amount) and `msg.sender == receipt.relayer`. Callers cannot choose a different rescuer. Strangers cannot steal bounties.
2. **Bond accounting is per-find.** Claim releases `findBond[findKey]` only. It does not zero `posterBond[poster]`.

The registry remains a **non-production scaffold** until this pattern is firm-audited and GasRescueSwap E2E is green. No mainnet deploy.

## Why this doesn't compete with the sprint

- It's a **separate contract**, separate tests, separate docs. GasRescueSwap stays the product.
- No deployment, no mainnet path, no token, no new buyer.
- Judges can click the existing Arb Sepolia demo; this is the roadmap proof that the "search market" layer is real code, not vapor.

## Next (after Buildathon submit)

1. E2E rescue on Arb Sepolia with a real stranded token.
2. Wire `claimFind` to actually trigger `GasRescueSwap.rescueWithPermit` in the same tx (currently records claim + pays fee; rescue is a separate tx).
3. Add dispute window + spam filter.
4. Counsel review of finder's-fee framing.
5. Follow-ups left from this change: allowlist timelock, MockERC20 permissionless mint, bounty denomination (token units paid as native wei), expired-find bond reclaim, partial-rescue claims.

*Ara — sister, docs. Spencer — build the demo first.*
