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
 * Prefer CF-Connecting-IP when Cloudflare set a single IP. True-Client-IP is
 * not a fallback: Cloudflare sets it only on Enterprise, so a client can
 * supply it. Otherwise walk X-Forwarded-For from the right and skip
 * TRUSTED_PROXY_HOPS platform addresses (default 1, the Cloudflare hop).
 * A chain that is shorter than that suffix is a direct connection: use the
 * rightmost hop, not the leftmost.
 *
 * IPv6 rate-limit keys are the /64 prefix. IPv4, including IPv4-mapped IPv6
 * (::ffff:a.b.c.d), stays one bucket per address.
 */

const DISABLED_HOPS = new Set(["off", "false", "none"]);

function headerValue(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : "";
  if (value == null) return "";
  return String(value);
}

function parseIpv4(s) {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const nums = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function stripIpDecorations(raw) {
  let s = String(raw).trim().replace(/^"|"$/g, "");
  if (!s) return "";
  const bracketed = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) s = bracketed[1];
  else {
    const v4Port = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (v4Port) s = v4Port[1];
  }
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  return s;
}

/**
 * Canonical address. IPv6 is eight lowercase groups with :: expanded.
 * IPv4-mapped IPv6 (::ffff:a.b.c.d and the hex form) is the IPv4 address.
 * Brackets, a trailing port, and a zone id are stripped. Empty if invalid.
 */
export function normalizeIp(raw) {
  if (raw == null) return "";
  const s = stripIpDecorations(raw);
  if (!s) return "";

  let body = s;
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4part = lastColon === -1 ? s : s.slice(lastColon + 1);
    const nums = parseIpv4(v4part);
    if (!nums) return "";
    if (lastColon === -1) return nums.join(".");
    const hi = ((nums[0] << 8) | nums[1]).toString(16);
    const lo = ((nums[2] << 8) | nums[3]).toString(16);
    body = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  body = body.toLowerCase();
  if (!body.includes(":") || !/^[0-9a-f:]+$/.test(body) || body.length > 45) return "";
  if ((body.match(/::/g) || []).length > 1) return "";

  let head = [];
  let tail = [];
  if (body.includes("::")) {
    const [h, t] = body.split("::");
    head = h ? h.split(":") : [];
    tail = t ? t.split(":") : [];
  } else {
    head = body.split(":");
  }
  const groupsOk = (groups) => groups.every((g) => g.length >= 1 && g.length <= 4 && /^[0-9a-f]+$/.test(g));
  if (!groupsOk(head) || !groupsOk(tail)) return "";
  const missing = 8 - head.length - tail.length;
  if (body.includes("::")) {
    if (missing < 1) return "";
  } else if (missing !== 0) {
    return "";
  }
  const groups = [...head, ...Array(missing).fill("0"), ...tail].map((g) => g.padStart(4, "0"));
  if (groups.length !== 8) return "";
  const mapped =
    groups[0] === "0000" &&
    groups[1] === "0000" &&
    groups[2] === "0000" &&
    groups[3] === "0000" &&
    groups[4] === "0000" &&
    groups[5] === "ffff";
  if (mapped) {
    const hi = Number.parseInt(groups[6], 16);
    const lo = Number.parseInt(groups[7], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return groups.join(":");
}

/**
 * Rate-limit key. IPv4 (and IPv4-mapped IPv6) is the address itself.
 * IPv6 is the expanded /64 network address, so two hosts in one prefix share it.
 */
export function ipBucketKey(raw) {
  const ip = normalizeIp(raw);
  if (!ip) return "";
  if (!ip.includes(":")) return ip;
  const groups = ip.split(":");
  if (groups.length !== 8) return "";
  return `${groups[0]}:${groups[1]}:${groups[2]}:${groups[3]}:0000:0000:0000:0000`;
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
  const cf = singleClientHeader(req, "cf-connecting-ip");
  if (cf) return cf;

  const hops = Number.isInteger(opts.trustedProxyHops) ? opts.trustedProxyHops : 1;
  const chain = forwardedChain(req);
  if (chain.length) {
    if (hops > 0 && chain.length > hops) return chain[chain.length - 1 - hops];
    return chain[chain.length - 1];
  }
  return normalizeIp(req?.socket?.remoteAddress || "");
}
