# Auditor Role Definition

**Who is the auditor?**

The **auditor** is a dedicated AI agent (Grok bot) in the blockchain task force. It is **not** a human firm, **not** the builder, **not** the CEO, and **not** the production manager.

## Responsibilities
- Trace every design doc and every contract the builder produces.
- Check for: reentrancy, signature replay, access control, fee-on-transfer edge cases, slippage/partial-fill handling, nonce management, and non-permit token paths.
- Output a **severity-ranked findings list** (Critical / High / Medium / Low) with concrete fix suggestions.
- **Never approve** code or a design it has not fully traced.
- Re-run the audit after every material change.

## What it is NOT
- It is **not** a paid external audit (Trail of Bits, OpenZeppelin, etc.). Those come later, after the design is solid and we apply for ecosystem grants.
- It is the **internal gate** that keeps the bots from shipping the wrong thing again (like the fee skim).

## Gate rule
Nothing merges, nothing deploys to a new chain, and no mainnet work starts until the auditor bot has signed off on the current design + code.

See issues #3 and #4 for the current blocker.

## Secrets layout (issue #11)

Hot keys are **not** stored in the git repo, in `~/.gas-rescue/*.key`, or in chat.

| Role | Address (Arb Sepolia demo) | Where the key lives |
| --- | --- | --- |
| Relayer hot | process-derived; allowlisted via `setRelayer` | **Runtime env only**: `RELAYER_PRIVATE_KEY` in the Relayer process. GitHub Actions secret `RELAYER_PRIVATE_KEY_ARB_SEPOLIA` (do not overwrite Base VPS `RELAYER_PRIVATE_KEY`). Never a `.key` file. |
| Stranded user | `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` | **MetaMask only**. Signs Order + permit in the browser. Never on disk. Not a relayer. |
| Owner | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` | **Not a hot key for the Relayer.** Must not equal the relayer. For Audit Program eligibility, owner key is not kept on this machine; Foundry admin uses a local gitignored `.env` at mode `600` only when an owner tx is required. |

Auditor checks for issue #11:

1. `git ls-files` has no `.env` / `*.key`.
2. `git check-ignore -v` matches `.env`, `**/.env`, `*.key`.
3. No `~/.gas-rescue/**/*.key` files.
4. Relayer process has `RELAYER_PRIVATE_KEY` in env; `RELAYER_KEY_FILE` is unset; `/health` relayer address ≠ stranded user.
5. On-chain `relayers(0x5BFd…)` is false on the demo swap; the health relayer address is allowlisted.
