import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ipBucketKey } from "./clientIp.mjs";
import { fail } from "./httpError.mjs";
import { isAddress } from "./quoteRequest.mjs";

/** One successful rescue per wallet per window. A judge's single try fits. */
export const DEFAULT_RESCUE_LIMIT_PER_WALLET = 1;
/**
 * A few successes per IP per window. 3 covers the judge plus a second wallet
 * or a teammate on the same network, and stops one IP from emptying the
 * router's ~19 max payouts. Set RESCUE_LIMIT_PER_IP=0 to disable.
 */
export const DEFAULT_RESCUE_LIMIT_PER_IP = 3;
export const DEFAULT_RESCUE_LIMIT_WINDOW_MS = 4 * 60 * 60 * 1000;
const IN_PROGRESS_RETRY_SEC = 30;
const DISABLED = new Set(["0", "off", "false", "disabled", "none", "unlimited", "no"]);

function parseCap(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).trim().toLowerCase();
  if (s === "") return fallback;
  if (DISABLED.has(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) return fallback;
  if (n === 0) return null;
  return n;
}

function parseWindowMs(env) {
  const msRaw = env.RESCUE_LIMIT_WINDOW_MS;
  if (msRaw !== undefined && String(msRaw).trim() !== "") {
    const n = Number(String(msRaw).trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const hoursRaw = env.RESCUE_LIMIT_WINDOW_HOURS;
  if (hoursRaw !== undefined && String(hoursRaw).trim() !== "") {
    const n = Number(String(hoursRaw).trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n * 60 * 60 * 1000);
  }
  return DEFAULT_RESCUE_LIMIT_WINDOW_MS;
}

/**
 * Unset env vars use the defaults. Spencer does not need a Render env change.
 * A cap of 0 / off / false / disabled turns that limit off. The other stays.
 * @param {Record<string, string | undefined>} [env]
 */
export function parseRescueLimitConfig(env = {}) {
  return {
    perWallet: parseCap(env.RESCUE_LIMIT_PER_WALLET, DEFAULT_RESCUE_LIMIT_PER_WALLET),
    perIp: parseCap(env.RESCUE_LIMIT_PER_IP, DEFAULT_RESCUE_LIMIT_PER_IP),
    windowMs: parseWindowMs(env),
  };
}

function walletKey(wallet) {
  return String(wallet || "").trim().toLowerCase();
}

function retryAfterSeconds(retryAtMs, nowMs) {
  return Math.max(1, Math.ceil((retryAtMs - nowMs) / 1000));
}

function windowDecision(code, events, limit, nowMs, windowMs) {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const index = Math.max(0, sorted.length - limit);
  const retryAtMs = sorted[index].atMs + windowMs;
  const retryAt = new Date(retryAtMs).toISOString();
  const retryAfter = retryAfterSeconds(retryAtMs, nowMs);
  const message =
    code === "rate_limited_wallet"
      ? limit === 1
        ? `This wallet already got a rescue. You can try again at ${retryAt}.`
        : `This wallet already used its ${limit} rescues for this period. You can try again at ${retryAt}.`
      : `Too many rescues from this network already went through (limit ${limit}). You can try again at ${retryAt}.`;
  return { limited: true, code, message, retryAfter, retryAt, inProgress: false };
}

function inProgressDecision(code, nowMs) {
  const retryAtMs = nowMs + IN_PROGRESS_RETRY_SEC * 1000;
  const retryAt = new Date(retryAtMs).toISOString();
  const message =
    code === "rate_limited_wallet"
      ? `A rescue for this wallet is already in progress. You can try again at ${retryAt}.`
      : `A rescue from this network is already in progress. You can try again at ${retryAt}.`;
  return {
    limited: true,
    code,
    message,
    retryAfter: IN_PROGRESS_RETRY_SEC,
    retryAt,
    inProgress: true,
  };
}

function validStoredEvent(event) {
  if (!event || typeof event !== "object") return false;
  if (!isAddress(event.wallet)) return false;
  if (typeof event.atMs !== "number" || !Number.isFinite(event.atMs)) return false;
  if (event.ip != null && typeof event.ip !== "string") return false;
  return true;
}

/**
 * Counts successful rescues only. Failed and simulation-reverted rescues
 * release their in-flight hold and are not stored.
 *
 * @param {object} [opts]
 * @param {ReturnType<typeof parseRescueLimitConfig>} [opts.config]
 * @param {Record<string, string | undefined>} [opts.env]
 * @param {string} [opts.dataDir]
 * @param {string} [opts.filePath]
 * @param {() => number} [opts.now]
 * @param {(msg: string) => void} [opts.log]
 */
export function createRescueLimiter(opts = {}) {
  const config = opts.config || parseRescueLimitConfig(opts.env || {});
  const now = opts.now || (() => Date.now());
  const log = opts.log || ((msg) => console.error(msg));
  const filePath = opts.filePath || (opts.dataDir ? join(opts.dataDir, "rescue-limits.json") : "");

  /** @type {{ wallet: string, ip: string, atMs: number }[]} */
  let events = [];
  /** @type {Map<string, number>} */
  const inflightWallet = new Map();
  /** @type {Map<string, number>} */
  const inflightIp = new Map();
  let writeChain = Promise.resolve();

  function prune(atMs) {
    const cutoff = atMs - config.windowMs;
    events = events.filter((event) => event.atMs > cutoff);
  }

  function bump(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  function drop(map, key) {
    const next = (map.get(key) || 0) - 1;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }

  function evaluate(wallet, ip) {
    const atMs = now();
    prune(atMs);
    const wKey = walletKey(wallet);
    const ipKey = ipBucketKey(ip);
    const walletEvents = events.filter((event) => event.wallet === wKey);
    const ipEvents = ipKey ? events.filter((event) => event.ip === ipKey) : [];
    if (config.perWallet != null && walletEvents.length >= config.perWallet) {
      return windowDecision("rate_limited_wallet", walletEvents, config.perWallet, atMs, config.windowMs);
    }
    if (config.perIp != null && ipKey && ipEvents.length >= config.perIp) {
      return windowDecision("rate_limited_ip", ipEvents, config.perIp, atMs, config.windowMs);
    }
    const walletHeld = inflightWallet.get(wKey) || 0;
    const ipHeld = ipKey ? inflightIp.get(ipKey) || 0 : 0;
    if (config.perWallet != null && walletEvents.length + walletHeld >= config.perWallet) {
      return inProgressDecision("rate_limited_wallet", atMs);
    }
    if (config.perIp != null && ipKey && ipEvents.length + ipHeld >= config.perIp) {
      return inProgressDecision("rate_limited_ip", atMs);
    }
    return { limited: false };
  }

  async function writeSnapshot() {
    if (!filePath) return;
    const atMs = now();
    prune(atMs);
    const snapshot = JSON.stringify({ version: 1, events });
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await writeFile(tmp, snapshot, { mode: 0o600 });
    await rename(tmp, filePath);
  }

  function persist() {
    if (!filePath) return Promise.resolve();
    writeChain = writeChain.then(writeSnapshot, writeSnapshot);
    return writeChain;
  }

  async function load() {
    if (!filePath) return;
    let raw;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return;
      log("rescue_limit_load ignored");
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) {
        log("rescue_limit_load ignored");
        return;
      }
      events = parsed.events
        .filter(validStoredEvent)
        .map((event) => ({
          wallet: walletKey(event.wallet),
          ip: typeof event.ip === "string" ? ipBucketKey(event.ip) : "",
          atMs: event.atMs,
        }));
      prune(now());
    } catch {
      log("rescue_limit_load ignored");
      events = [];
    }
  }

  const ready = load();

  function limitsDisabled() {
    return config.perWallet == null && config.perIp == null;
  }

  async function check(wallet, ip) {
    await ready;
    return evaluate(wallet, ip);
  }

  /**
   * Hold a slot until finish(success). Only success is stored.
   * Concurrent begins are serialized after `ready` because the hold is sync.
   */
  async function begin(wallet, ip) {
    await ready;
    if (limitsDisabled()) {
      return { ok: true, async finish() {} };
    }
    const decision = evaluate(wallet, ip);
    if (decision.limited) return { ok: false, decision };
    const wKey = walletKey(wallet);
    const ipKey = ipBucketKey(ip);
    if (config.perWallet != null) bump(inflightWallet, wKey);
    if (config.perIp != null && ipKey) bump(inflightIp, ipKey);
    let done = false;
    return {
      ok: true,
      async finish(success) {
        if (done) return;
        done = true;
        if (config.perWallet != null) drop(inflightWallet, wKey);
        if (config.perIp != null && ipKey) drop(inflightIp, ipKey);
        if (!success) return;
        events.push({ wallet: wKey, ip: ipKey, atMs: now() });
        try {
          await persist();
        } catch {
          log("rescue_limit_persist failed");
        }
      },
    };
  }

  function publicConfig() {
    return {
      perWallet: config.perWallet,
      perIp: config.perIp,
      windowMs: config.windowMs,
      walletEnabled: config.perWallet != null,
      ipEnabled: config.perIp != null,
    };
  }

  return { check, begin, publicConfig, ready, config };
}

export function errorFromLimit(decision) {
  if (!decision || !decision.limited) return null;
  return fail(429, decision.code, decision.message, {
    retryAfter: decision.retryAfter,
    retryAt: decision.retryAt,
  });
}
