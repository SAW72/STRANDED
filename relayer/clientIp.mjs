/**
 * Client IP behind Render.
 *
 * Public traffic arrives as Cloudflare → Render's proxy → this process.
 * A typical request is:
 *   CF-Connecting-IP: <client>                         (Cloudflare overwrites this)
 *   X-Forwarded-For: <spoofable…>, <client>, <cloudflare>
 *   socket.remoteAddress: <private Render hop>
 *
 * The leftmost X-Forwarded-For entry is attacker-controlled because Render
 * appends instead of replacing the header. The rightmost entry is usually a
 * Cloudflare address shared by many visitors, so keying on it would throttle
 * unrelated judges together.
 *
 * Prefer CF-Connecting-IP / True-Client-IP when Cloudflare set a single IP.
 * Otherwise walk X-Forwarded-For from the right and skip
 * TRUSTED_PROXY_HOPS platform addresses (default 1, the Cloudflare hop).
 * A chain that is shorter than that suffix is a direct connection: use the
 * rightmost hop, not the leftmost.
 */

const DISABLED_HOPS = new Set(["off", "false", "none"]);

function headerValue(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : "";
  if (value == null) return "";
  return String(value);
}

export function normalizeIp(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().replace(/^"|"$/g, "");
  if (!s) return "";
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (s.toLowerCase().startsWith("::ffff:")) s = s.slice(7);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) {
    const ok = s.split(".").every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return n >= 0 && n <= 255;
    });
    return ok ? s : "";
  }
  if (s.includes(":") && /^[0-9a-f:]+$/i.test(s) && s.length <= 45) return s.toLowerCase();
  return "";
}

/** @param {string | undefined} raw */
export function parseTrustedProxyHops(raw) {
  if (raw == null || String(raw).trim() === "") return 1;
  const s = String(raw).trim().toLowerCase();
  if (DISABLED_HOPS.has(s)) return 0;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 8) return 1;
  return n;
}

function forwardedChain(req) {
  const raw = headerValue(req, "x-forwarded-for");
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => normalizeIp(part))
    .filter(Boolean);
}

function singleClientHeader(req, name) {
  const raw = headerValue(req, name).trim();
  if (!raw || raw.includes(",")) return "";
  return normalizeIp(raw);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {{ trustedProxyHops?: number }} [opts]
 */
export function clientIp(req, opts = {}) {
  const cf = singleClientHeader(req, "cf-connecting-ip") || singleClientHeader(req, "true-client-ip");
  if (cf) return cf;

  const hops = Number.isInteger(opts.trustedProxyHops) ? opts.trustedProxyHops : 1;
  const chain = forwardedChain(req);
  if (chain.length) {
    if (hops > 0 && chain.length > hops) return chain[chain.length - 1 - hops];
    return chain[chain.length - 1];
  }
  return normalizeIp(req?.socket?.remoteAddress || "");
}
