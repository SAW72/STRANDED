/**
 * Per-user Order nonce reservation (Arb Sepolia GasRescueSwap).
 *
 * On-chain: `usedNonces(user, nonce) -> bool` (IGasRescueSwapViews). There is
 * no sequential `nextNonce` view — unused values are any uint256 not yet
 * marked used. The contract consumes a nonce only on a successful rescue.
 *
 * Relayer scheme (single-process, testnet):
 *  1. Serialize reserve() per user (lowercase address) so concurrent quotes
 *     cannot pick the same value.
 *  2. Candidate starts at max(lastReserved+1, Date.now() ms). Using wall-clock
 *     ms keeps post-restart quotes above previously issued Date.now() nonces.
 *  3. Skip in-memory reservations that have not expired.
 *  4. Probe `usedNonces` when an `isNonceUsed` callback is provided; skip used.
 *  5. Hold the reservation until quote deadline (default 30m) or markConsumed.
 *
 * Restart loses the in-memory map. The Date.now() floor plus the on-chain
 * probe avoids colliding with spent nonces; two processes are not coordinated
 * (Render runs one web instance).
 */

function userKey(user) {
  return String(user || "").toLowerCase();
}

function nonceKey(nonce) {
  return BigInt(nonce).toString();
}

/**
 * @param {object} [opts]
 * @param {((user: string, nonce: bigint) => Promise<boolean>) | null} [opts.isNonceUsed]
 * @param {() => number} [opts.now]
 * @param {number} [opts.maxProbes]
 */
export function createNonceStore(opts = {}) {
  const isNonceUsed = opts.isNonceUsed || null;
  const now = opts.now || Date.now;
  const maxProbes = Number(opts.maxProbes || 32);

  /** @type {Map<string, Map<string, { expiresAtMs: number, consumed: boolean }>>} */
  const reserved = new Map();
  /** @type {Map<string, bigint>} */
  const nextHint = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const locks = new Map();

  function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  function bucket(key) {
    let map = reserved.get(key);
    if (!map) {
      map = new Map();
      reserved.set(key, map);
    }
    return map;
  }

  function prune(key, atMs) {
    const map = reserved.get(key);
    if (!map) return;
    for (const [n, rec] of map) {
      if (!rec.consumed && rec.expiresAtMs <= atMs) map.delete(n);
    }
  }

  function isHeld(key, nonce, atMs) {
    const rec = reserved.get(key)?.get(nonceKey(nonce));
    if (!rec) return false;
    if (rec.consumed) return true;
    return rec.expiresAtMs > atMs;
  }

  /**
   * Reserve the next unused nonce for `user`.
   * @param {string} user
   * @param {{ ttlMs?: number }} [reserveOpts]
   * @returns {Promise<bigint>}
   */
  async function reserve(user, reserveOpts = {}) {
    const key = userKey(user);
    if (!key) {
      throw Object.assign(new Error("user required for nonce reserve"), { status: 400 });
    }
    const ttlMs = Number(reserveOpts.ttlMs ?? 30 * 60 * 1000);
    return withLock(key, async () => {
      const atMs = now();
      prune(key, atMs);
      const wall = BigInt(atMs);
      const hinted = nextHint.get(key) ?? 0n;
      let candidate = hinted > wall ? hinted : wall;
      for (let i = 0; i < maxProbes; i++) {
        const nonce = candidate + BigInt(i);
        if (isHeld(key, nonce, atMs)) continue;
        if (isNonceUsed) {
          const used = await isNonceUsed(user, nonce);
          if (used) continue;
        }
        bucket(key).set(nonceKey(nonce), { expiresAtMs: atMs + ttlMs, consumed: false });
        nextHint.set(key, nonce + 1n);
        return nonce;
      }
      throw Object.assign(new Error("nonce_unavailable"), {
        status: 503,
        error: "nonce_unavailable",
      });
    });
  }

  function markConsumed(user, nonce) {
    const key = userKey(user);
    const rec = bucket(key).get(nonceKey(nonce)) || { expiresAtMs: 0, consumed: false };
    rec.consumed = true;
    bucket(key).set(nonceKey(nonce), rec);
    const n = BigInt(nonce);
    const hinted = nextHint.get(key) ?? 0n;
    if (n + 1n > hinted) nextHint.set(key, n + 1n);
  }

  function peek(user, nonce) {
    const key = userKey(user);
    prune(key, now());
    return reserved.get(key)?.get(nonceKey(nonce)) || null;
  }

  return { reserve, markConsumed, peek, userKey };
}
