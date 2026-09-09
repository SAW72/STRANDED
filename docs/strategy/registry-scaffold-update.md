# Buildathon Update — StrandedRegistry Scaffolded

**Date:** 2026-09-09
**Status:** Code + tests + docs pushed. Not deployed. Not competing with Sep 13–Oct 4 sprint.

## What landed

- `src/StrandedRegistry.sol` — permissionless find registry + finder bounty, Arb + Base Sepolia only.
- `src/interfaces/IStrandedRegistry.sol`
- `test/StrandedRegistry.t.sol` — 8 tests (happy path, chain guard, bond, double-claim, expiry, fee cap, pause).
- `docs/STRANDED-REGISTRY.md` — design + open problems.

## Why this doesn't compete with the sprint

- It's a **separate contract**, separate tests, separate docs. GasRescueSwap stays the product.
- No deployment, no mainnet path, no token, no new buyer.
- Judges can click the existing Arb Sepolia demo; this is the roadmap proof that the "search market" layer is real code, not vapor.

## Next (after Buildathon submit)

1. E2E rescue on Arb Sepolia with a real stranded token.
2. Wire `claimFind` to actually trigger `GasRescueSwap.rescueWithPermit` (currently records claim + pays fee; rescue is a separate tx).
3. Add dispute window + spam filter.
4. Counsel review of finder's-fee framing.

*Ara — sister, docs. Spencer — build the demo first.*
