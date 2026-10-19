import { createHmac, randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const TX_RE = /^0x[0-9a-f]{64}$/;
const CHAINS = new Set([84532, 421614]);
const MIN_SECRET_BYTES = 32;
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_FAST_ATTEMPTS = 6;
const NOT_FOUND_ATTEMPTS = 8;
const MAX_MINE_ATTEMPTS = 24;
const MAX_PARALLEL = 4;
const CONFIRM_WAIT_MS = 20_000;
const COMPACT_AFTER_LINES = 6;
const DEFAULT_MIN_CONFIRMATIONS = 2;

let tail = Promise.resolve();
let io = Promise.resolve();
let settles = Promise.resolve();
const scheduledRetries = new Set();
const retryTimers = new Map();
const inFlight = new Set();

function enqueueWork(fn) {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function enqueueIo(fn) {
  const run = io.then(fn, fn);
  io = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function track(promise) {
  const run = Promise.resolve(promise).then(
    () => undefined,
    () => undefined,
  );
  settles = Promise.all([settles, run]).then(
    () => undefined,
    () => undefined,
  );
}

export function flushPointsNotify() {
  return tail.then(() => settles);
}

export function clearPointsRetryTimers() {
  for (const handle of retryTimers.values()) clearTimeout(handle);
  retryTimers.clear();
  scheduledRetries.clear();
  inFlight.clear();
}

export function configuredIngestSecret(env = process.env) {
  const secret = String(env.POINTS_INGEST_SECRET || "").trim();
  if (Buffer.byteLength(secret) < MIN_SECRET_BYTES) return "";
  return secret;
}

/** Unset stays at 2. 0 and any other out-of-range value are logged and stay at 2. */
export function pointsMinConfirmations(env = process.env, txHash = "") {
  const text = String(env.POINTS_MIN_CONFIRMATIONS ?? "").trim();
  if (!text) return DEFAULT_MIN_CONFIRMATIONS;
  if (!/^[1-9][0-9]{0,2}$/.test(text)) {
    console.error("points_notify", "confirmations", txHash);
    return DEFAULT_MIN_CONFIRMATIONS;
  }
  const value = Number(text);
  if (value < 1 || value > 128) {
    console.error("points_notify", "confirmations", txHash);
    return DEFAULT_MIN_CONFIRMATIONS;
  }
  return value;
}

export function pointsApiRoot(env = process.env) {
  const raw = String(env.POINTS_API_URL || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  return raw.replace(/\/$/, "");
}

export function pointsPushEnabled(env = process.env) {
  return Boolean(configuredIngestSecret(env) && pointsApiRoot(env));
}

function noteUrl(env) {
  const raw = String(env.POINTS_API_URL || "").trim();
  if (raw && !pointsApiRoot(env)) console.error("points_notify", "url");
}

export function pointsOutboxPath(dataDir) {
  return join(dataDir || process.env.DATA_DIR || "./data", "points-outbox.jsonl");
}

/**
 * Queues a post after an optional receipt wait. Returns immediately.
 * The receipt wait is not on the path a later submission uses.
 * Does nothing when the secret is under 32 bytes or POINTS_API_URL is not https.
 * Never call this from the broadcast retry callback.
 */
export function schedulePointsNotify(opts) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return { enabled: false };
  }
  const settled = launchDelivery({ ...opts, env });
  void settled.catch(() => {
    console.error("points_notify", "error");
  });
  return { enabled: true, scheduled: true };
}

/** Startup and explicit retry. No-op when the hook is disabled. */
export function schedulePointsRetry(opts = {}) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return { enabled: false };
  }
  const settled = launchRetry({ ...opts, env });
  void settled.catch(() => {
    console.error("points_notify", "error");
  });
  return { enabled: true, scheduled: true };
}

export function deliverPointsNotify(opts) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return Promise.resolve({ enabled: false });
  }
  return launchDelivery({ ...opts, env });
}

export function retryPointsOutbox(opts = {}) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) {
    noteUrl(env);
    return Promise.resolve({ enabled: false });
  }
  return launchRetry({ ...opts, env });
}

/**
 * Records old hash -> new hash before returning. A later restart follows the link.
 * @param {object} opts
 */
export function notePointsReplacement(opts) {
  const item = normalizeItem(opts.chainId, opts.txHash);
  const replacedBy = String(opts.replacedBy || "").trim().toLowerCase();
  if (!TX_RE.test(replacedBy) || replacedBy === item.txHash) {
    const err = new Error("invalid_tx_hash");
    err.code = "invalid_tx_hash";
    return Promise.reject(err);
  }
  const file = pointsOutboxPath(opts.dataDir);
  return enqueueIo(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await appendDurable(file, {
      op: "replace",
      chainId: item.chainId,
      txHash: item.txHash,
      replacedBy,
      at: stamp(opts),
    });
    return { replaced: true, txHash: replacedBy };
  });
}

/** Drops a pending hash. A later restart posts nothing for it. */
export function notePointsCancel(opts) {
  const item = normalizeItem(opts.chainId, opts.txHash);
  const file = pointsOutboxPath(opts.dataDir);
  return enqueueIo(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await appendDurable(file, { op: "cancel", txHash: item.txHash, at: stamp(opts) });
    return { cancelled: true };
  });
}

function launchDelivery(opts) {
  let jobs = [];
  const prepared = enqueueWork(async () => {
    jobs = await startDelivery(opts);
  });
  const settled = prepared.then(() => Promise.all(jobs)).then((counts) => ({
    enabled: true,
    sent: counts.reduce((sum, n) => sum + n, 0),
  }));
  track(settled);
  return settled;
}

function launchRetry(opts) {
  let job = Promise.resolve({ enabled: true, sent: 0 });
  const prepared = enqueueWork(async () => {
    const file = pointsOutboxPath(opts.dataDir);
    await sweepTemps(file);
    const items = await enqueueIo(async () => [...(await readState(file)).values()]);
    job = runPool(file, opts, items);
  });
  const settled = prepared.then(() => job);
  track(settled);
  return settled;
}

async function startDelivery(opts) {
  const item = normalizeItem(opts.chainId, opts.txHash);
  const file = pointsOutboxPath(opts.dataDir);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await sweepTemps(file);
  const items = await enqueueIo(async () => {
    const pending = await readState(file);
    if (!pending.has(item.txHash)) {
      await writeRecord(file, {
        op: "enqueue",
        chainId: item.chainId,
        txHash: item.txHash,
        at: stamp(opts),
        attempts: 0,
        notFound: 0,
      });
    }
    const state = await readState(file);
    const picked = [];
    for (const row of state.values()) {
      if (row.txHash === item.txHash || !scheduledRetries.has(row.txHash)) picked.push(row);
    }
    return picked;
  });
  return items.map((row) => claim(file, opts, row));
}

async function runPool(file, opts, items) {
  const width = poolWidth(opts);
  let sent = 0;
  for (let i = 0; i < items.length; i += width) {
    const counts = await Promise.all(items.slice(i, i + width).map((item) => claim(file, opts, item)));
    sent += counts.reduce((sum, n) => sum + n, 0);
  }
  return { enabled: true, sent };
}

function poolWidth(opts) {
  const raw = Number(opts.maxParallel);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return MAX_PARALLEL;
}

function claim(file, opts, item) {
  if (!item || inFlight.has(item.txHash)) return Promise.resolve(0);
  inFlight.add(item.txHash);
  return settleItem(file, opts, item).finally(() => {
    inFlight.delete(item.txHash);
  });
}

async function sendOne(opts, txHash) {
  const file = pointsOutboxPath(opts.dataDir);
  const item = await enqueueIo(async () => (await readState(file)).get(txHash) || null);
  if (!item) return 0;
  return claim(file, opts, item);
}

async function settleItem(file, opts, item) {
  const outcome = await confirmIfNeeded(opts, item);
  return enqueueIo(() => applyOutcome(file, opts, outcome));
}

async function confirmIfNeeded(opts, item) {
  if (typeof opts.confirmReceipt !== "function") return { gate: "ready", item };
  const waitMs = Number.isFinite(Number(opts.confirmWaitMs)) ? Number(opts.confirmWaitMs) : CONFIRM_WAIT_MS;
  let receipt;
  try {
    receipt = await withTimeout(Promise.resolve().then(() => opts.confirmReceipt(item.txHash)), waitMs);
  } catch {
    return { gate: "pending", item, error: "receipt_pending" };
  }
  if (!receiptAccepted(receipt)) return { gate: "rejected", item };
  const next = itemForReceipt(item, receipt);
  if (!next) return { gate: "pending", item, error: "receipt_pending" };
  return {
    gate: "ready",
    item: next,
    replaces: next.txHash === item.txHash ? "" : item.txHash,
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handle = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("confirm_timeout"));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(handle);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(handle);
        reject(err);
      },
    );
  });
}

function itemForReceipt(item, receipt) {
  const raw = receipt.transactionHash;
  if (raw === undefined || raw === null || raw === "") return item;
  const hash = String(raw).trim().toLowerCase();
  if (hash === item.txHash) return item;
  if (!TX_RE.test(hash)) return null;
  return { chainId: item.chainId, txHash: hash, attempts: 0, notFound: 0 };
}

async function applyOutcome(file, opts, outcome) {
  const item = outcome.item;
  if (outcome.gate === "pending") {
    const error = outcome.error || "receipt_pending";
    const attempts = await noteAttempt(file, opts, item, error);
    if (error === "receipt_pending" && attempts >= MAX_MINE_ATTEMPTS) {
      await writeRecord(file, { op: "dropped", txHash: item.txHash, at: stamp(opts), error: "not_mined" });
      console.error("points_notify", "not_mined", item.txHash);
      return 0;
    }
    scheduleBackoff(opts, item.txHash, attempts);
    return 0;
  }
  if (outcome.gate === "rejected") {
    await writeRecord(file, { op: "dropped", txHash: item.txHash, at: stamp(opts), error: "status_failed" });
    return 0;
  }
  if (outcome.replaces) {
    await writeRecord(file, { op: "dropped", txHash: outcome.replaces, at: stamp(opts), error: "replaced" });
    const pending = await readState(file);
    if (!pending.has(item.txHash)) {
      await writeRecord(file, {
        op: "enqueue",
        chainId: item.chainId,
        txHash: item.txHash,
        at: stamp(opts),
        attempts: 0,
        notFound: 0,
      });
    }
  }
  const result = await postIngest(opts, item);
  if (result.ok) {
    await writeRecord(file, { op: "delivered", txHash: item.txHash, at: stamp(opts) });
    return 1;
  }
  if (result.alert) {
    console.error("points_notify", "alert", result.error, item.txHash);
    const attempts = await noteAttempt(file, opts, item, result.error);
    scheduleBackoff(opts, item.txHash, attempts);
    return 0;
  }
  if (result.permanent) {
    await writeRecord(file, { op: "dropped", txHash: item.txHash, at: stamp(opts), error: result.error });
    return 0;
  }
  const attempts = await noteAttempt(file, opts, item, result.error);
  const pending = await readState(file);
  const notFound = pending.get(item.txHash)?.notFound || 0;
  if (result.error === "http_404" && notFound >= NOT_FOUND_ATTEMPTS) {
    await writeRecord(file, { op: "dropped", txHash: item.txHash, at: stamp(opts), error: "http_404" });
    console.error("points_notify", "not_found", item.txHash);
    return 0;
  }
  scheduleBackoff(opts, item.txHash, attempts);
  return 0;
}

function receiptAccepted(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const status = receipt.status;
  return status === "success" || status === "0x1" || status === 1;
}

async function noteAttempt(file, opts, item, error) {
  const pending = await readState(file);
  const attempts = (pending.get(item.txHash)?.attempts || 0) + 1;
  await writeRecord(file, { op: "attempt", txHash: item.txHash, at: stamp(opts), error, attempts });
  return attempts;
}

function scheduleBackoff(opts, txHash, attempts) {
  if (scheduledRetries.has(txHash)) return;
  if (attempts === MAX_FAST_ATTEMPTS) console.error("points_notify", "cap", txHash);
  scheduledRetries.add(txHash);
  const delay = delayForAttempt(attempts, opts);
  const run = async () => {
    scheduledRetries.delete(txHash);
    retryTimers.delete(txHash);
    await sendOne(opts, txHash);
  };
  if (typeof opts.scheduleDelay === "function") {
    opts.scheduleDelay(run, delay);
    return;
  }
  const handle = setTimeout(() => {
    const job = run();
    track(job);
    void job.catch(() => {
      console.error("points_notify", "error");
    });
  }, delay);
  if (typeof handle.unref === "function") handle.unref();
  retryTimers.set(txHash, handle);
}

function delayForAttempt(attempts, opts) {
  if (attempts < MAX_FAST_ATTEMPTS) {
    return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  }
  const jitter = unitInterval(typeof opts.jitter === "function" ? opts.jitter() : Math.random());
  return Math.min(RETRY_MAX_DELAY_MS, Math.max(1, Math.round(RETRY_MAX_DELAY_MS * (0.5 + 0.5 * jitter))));
}

function unitInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

async function postIngest(opts, item) {
  const env = opts.env || process.env;
  const secret = configuredIngestSecret(env);
  const root = pointsApiRoot(env);
  if (!secret || !root) return { ok: false, error: "unconfigured", alert: true };
  const body = JSON.stringify({ chainId: item.chainId, txHash: item.txHash });
  const timestamp = String(Math.floor(stampMs(opts) / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
  const fetchImpl = opts.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(`${root}/v1/ingest`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-points-timestamp": timestamp,
        "x-points-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "network", alert: true };
  }
  if (response.status >= 200 && response.status < 300) return { ok: true };
  if (response.status === 404) {
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
    }
    if (text.includes("receipt_not_found")) return { ok: false, error: "http_404" };
    return { ok: false, error: "unreachable", alert: true };
  }
  if (
    response.status === 401 ||
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    return { ok: false, error: `http_${response.status}` };
  }
  return { ok: false, error: `http_${response.status}`, permanent: true };
}

function normalizeItem(chainId, txHash) {
  const id = Number(chainId);
  const hash = String(txHash || "").trim().toLowerCase();
  if (!CHAINS.has(id)) {
    const err = new Error("invalid_chain");
    err.code = "invalid_chain";
    throw err;
  }
  if (!TX_RE.test(hash)) {
    const err = new Error("invalid_tx_hash");
    err.code = "invalid_tx_hash";
    throw err;
  }
  return { chainId: id, txHash: hash };
}

function stamp(opts) {
  return new Date(stampMs(opts)).toISOString();
}

function stampMs(opts) {
  return opts.now ? opts.now() : Date.now();
}

async function writeRecord(file, record) {
  await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await maybeCompact(file);
}

async function appendDurable(file, record) {
  const fh = await open(file, "a", 0o600);
  try {
    await fh.appendFile(`${JSON.stringify(record)}\n`);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await maybeCompact(file);
}

async function maybeCompact(file) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < COMPACT_AFTER_LINES) return;
  const pending = await readState(file);
  const next = [...pending.values()]
    .map((item) =>
      JSON.stringify({
        op: "enqueue",
        chainId: item.chainId,
        txHash: item.txHash,
        at: new Date().toISOString(),
        attempts: item.attempts,
        notFound: item.notFound || 0,
      }),
    )
    .join("\n");
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const fh = await open(tmp, "w", 0o600);
  try {
    await fh.writeFile(next ? `${next}\n` : "");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function sweepTemps(file) {
  const dir = dirname(file);
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  const base = basename(file);
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".tmp"))
      .map((name) => rm(join(dir, name), { force: true })),
  );
}

async function readState(file) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return new Map();
    throw err;
  }
  const pending = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row.txHash !== "string") continue;
    if (row.op === "enqueue") {
      if (!pending.has(row.txHash)) {
        pending.set(row.txHash, {
          chainId: Number(row.chainId),
          txHash: row.txHash,
          attempts: Number(row.attempts) || 0,
          notFound: Number(row.notFound) || 0,
        });
      }
    } else if (row.op === "attempt") {
      const current = pending.get(row.txHash);
      if (current) {
        current.attempts += 1;
        if (row.error === "http_404") current.notFound += 1;
      }
    } else if (row.op === "replace") {
      const next = String(row.replacedBy || "").trim().toLowerCase();
      const current = pending.get(row.txHash);
      if (!current || !TX_RE.test(next)) continue;
      pending.delete(row.txHash);
      if (!pending.has(next)) {
        pending.set(next, {
          chainId: current.chainId,
          txHash: next,
          attempts: current.attempts,
          notFound: current.notFound || 0,
        });
      }
    } else if (row.op === "cancel") {
      pending.delete(row.txHash);
    } else if (row.op === "delivered" || row.op === "dropped") {
      pending.delete(row.txHash);
    }
  }
  return pending;
}
