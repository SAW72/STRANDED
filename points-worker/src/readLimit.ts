const WINDOW_MS = 60_000;
const MAX_READS = 30;
const MAX_KEYS = 1_000;

const buckets = new Map<string, number[]>();

export const WALLET_READ_LIMIT = MAX_READS;
export const WALLET_READ_MAX_KEYS = MAX_KEYS;
export const WALLET_READ_CACHE = "public, max-age=30";

/** Per-isolate cap for points reads. Returns false when the caller should wait. */
export function allowWalletRead(request: Request, now = Date.now()): boolean {
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  evictExpired(now);
  const fresh = (buckets.get(ip) || []).filter((at) => now - at < WINDOW_MS);
  if (fresh.length >= MAX_READS) {
    buckets.set(ip, fresh);
    evictOverflow(ip);
    return false;
  }
  fresh.push(now);
  buckets.set(ip, fresh);
  evictOverflow(ip);
  return true;
}

export function walletReadBucketCount(): number {
  return buckets.size;
}

export function resetWalletReadLimit(): void {
  buckets.clear();
}

function evictExpired(now: number): void {
  for (const [key, stamps] of buckets) {
    const fresh = stamps.filter((at) => now - at < WINDOW_MS);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}

function evictOverflow(keep: string): void {
  while (buckets.size > MAX_KEYS) {
    let oldestKey = "";
    let oldestAt = Infinity;
    for (const [key, stamps] of buckets) {
      if (key === keep) continue;
      const at = stamps[0] ?? Infinity;
      if (at < oldestAt) {
        oldestAt = at;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    buckets.delete(oldestKey);
  }
}
