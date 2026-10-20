const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/**
 * Optional per-chain token check. Unset or blank means no check.
 * A set value that does not parse allows nothing (fail closed).
 * There is no default list in this module.
 */
export function parseTokenAllowlist(raw: string | undefined): Map<number, Set<string>> | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const map = new Map<number, Set<string>>();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        warnAllowlist();
        return map;
      }
      for (const [chainText, value] of Object.entries(parsed as Record<string, unknown>)) {
        const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
        for (const item of items) {
          if (typeof item === "string") addToken(map, chainText, item);
        }
      }
    } catch {
      warnAllowlist();
      return map;
    }
    return map;
  }
  let sawPiece = false;
  for (const part of text.split(";")) {
    const piece = part.trim();
    if (!piece) continue;
    sawPiece = true;
    const colon = piece.indexOf(":");
    if (colon < 0) {
      warnAllowlist();
      continue;
    }
    const chainText = piece.slice(0, colon).trim();
    for (const addressText of piece.slice(colon + 1).split(",")) addToken(map, chainText, addressText);
  }
  if (!sawPiece) warnAllowlist();
  return map;
}

function warnAllowlist(): void {
  console.warn(JSON.stringify({ event: "points_allowlist_ignored" }));
}

function addToken(map: Map<number, Set<string>>, chainText: string, addressText: string): void {
  const chain = chainText.trim();
  const address = addressText.trim().toLowerCase();
  if (!chain && !address) return;
  if (!/^[0-9]+$/.test(chain)) {
    console.log(JSON.stringify({ event: "points_allowlist_ignored" }));
    return;
  }
  const chainId = Number(chain);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    console.log(JSON.stringify({ event: "points_allowlist_ignored" }));
    return;
  }
  if (!ADDRESS_RE.test(address)) {
    if (address) console.log(JSON.stringify({ event: "points_allowlist_ignored" }));
    return;
  }
  let set = map.get(chainId);
  if (!set) {
    set = new Set();
    map.set(chainId, set);
  }
  set.add(address);
}
