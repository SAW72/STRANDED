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
