# Round 7 mutation notes

These tests fail if the named change is applied. They live in `relayer/test/points.round7.test.mjs` unless another file is named.

- N3, drop the sender filter in `findTxAtNonce`: `skips a different sender and a different nonce before the matching call`.
- N4, drop the nonce filter in `findTxAtNonce`: the same test.
- L6, drop the `start > head` guard: `leaves a future block unresolved and still finds the head and the chunk edges`.
- K1, chunk size far above 2000: `asks for log chunks no wider than 2000 blocks`.
- K2, `cursor = end + 2`: the head-and-edges test, transaction at the chunk boundary.
- K4, `while (cursor < head)`: the same test, transaction in the head block.
- K6, break after the first chunk: the same test, transaction in the second chunk.
- B3, backfill not wired to `findTxAtNonce`: `wires backfill to the nonce lookup`.
- B4, backfill ignores a missing call and skips the receipt: `posts a legacy row from its own receipt and posts nothing for a reverted one`.
- B5, a reverted receipt is posted: that same test, plus `posts nothing when the looked up receipt reverted`.
- T4, an in-process mismatch is not cancelled: `cancels an in-process replacement that is a different call`.
- T6, a different call on another hash is posted: `cancels a replacement whose receipt hash is a different call`.
- C5, the 404 cap uses the general attempt count: `keeps a high attempt count off the 404 cap`.
- C6, a chain error counts as not mined: `does not treat an rpc failure as a missing receipt` in `relayer/test/points.notify.test.mjs`, and `caps repeated lookup failures and still credits before that cap`.
- F1, a matching observe is always cancelled: `links a matching observe and does not enqueue a cancelled hash`.
- F2, a cancelled hash is enqueued again: the same test.
- F3, compaction drops cancel rows: `keeps cancel, replace, and unresolved rows across compaction`.
- F4, compaction drops replace links: the same test.
- U6, compaction drops unresolved rows: the same test.
- U11, delivery leaves the unresolved row: `clears an unresolved row when its replacement is delivered`.
- S2, the response does not wait for the outbox write: `waits for the outbox line and keeps the receipt hook on the notify path`, and `stays after broadcast in the relayer and out of the retry callback` in `relayer/test/points.notify.test.mjs`.
- S3, `onReplaced` is unwired: the same two tests.
- S9, the receipt path skips the notify schedule: the same two tests.
- P3, the retry cap is one wider than four: `caps retry receipt waits at four even when the pool is wider`.
- Z3, the archive insert guard has no `WHEN` clause: `keeps later ids above the archive and blocks archive edits` in `points-worker/test/port.test.mjs`. A new archive id still inserts. Replacing an existing id still throws.
