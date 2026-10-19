const WINDOW_MS = 60_000;
const MAX_READS = 30;

const buckets = new Map<string, number[]>();

export const WALLET_READ_LIMIT = MAX_READS;
export const WALLET_READ_CACHE = "public, max-age=30";

/** Per-isolate cap for GET /points/:wallet. Returns false when the caller should wait. */
export function allowWalletRead(request: Request, now = Date.now()): boolean {
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const fresh = (buckets.get(ip) || []).filter((at) => now - at < WINDOW_MS);
  if (fresh.length >= MAX_READS) {
    buckets.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  buckets.set(ip, fresh);
  return true;
}

export function resetWalletReadLimit(): void {
  buckets.clear();
}
