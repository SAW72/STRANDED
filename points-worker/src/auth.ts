const encoder = new TextEncoder();

/** Requests further than this from the Worker clock are rejected. */
export const MAX_SKEW_SECONDS = 5 * 60;

export function pointsPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}\n${rawBody}`;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Trimmed secret of at least 32 bytes, or null when it must not be used. */
export function normalizeSecret(secret: string | undefined): string | null {
  const trimmed = String(secret ?? "").trim();
  if (encoder.encode(trimmed).byteLength < 32) return null;
  return trimmed;
}

export async function signPoints(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(pointsPayload(timestamp, rawBody)));
  return toHex(new Uint8Array(mac));
}

/**
 * Constant-time MAC check. Both sides are hashed to a fixed length first so a
 * short or long header does not skip the comparison.
 */
export async function signaturesMatch(
  secret: string,
  timestamp: string,
  rawBody: string,
  provided: string,
): Promise<boolean> {
  const key = normalizeSecret(secret);
  if (!key || provided.length === 0 || provided.length > 256) return false;
  const expected = await signPoints(key, timestamp, rawBody);
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided.trim().toLowerCase())),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

/** Unix seconds. Returns null when the header is not an integer second count. */
export function timestampSkewSeconds(timestamp: string, nowMs: number): number | null {
  if (!/^[0-9]{1,12}$/.test(timestamp)) return null;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return null;
  return Math.abs(Math.floor(nowMs / 1000) - seconds);
}
