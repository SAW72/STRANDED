import { createHmac, randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { decodeFunctionData } from "viem";
import { rescueAbi } from "../rescueAbi.mjs";

const TX_RE = /^0x[0-9a-f]{64}$/;
const CHAINS = new Set([84532, 421614]);
const MIN_SECRET_BYTES = 32;
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_FAST_ATTEMPTS = 6;
/** Give up after this many worker receipt_not_found results. Outages do not count. */
const NOT_FOUND_ATTEMPTS = 8;
/** Give up after this many real not-mined receipt waits. Outages do not count. */
const MAX_MINE_ATTEMPTS = 24;
const MAX_PARALLEL = 4;
const PERMANENT_REJECTIONS = new Set([
  "status_failed",
  "wrong_chain",
  "wrong_contract",
  "missing_rescued_log",
  "invalid_body",
  "invalid_address",
  "invalid_receipt",
  "wallet_session_disabled",
  "registry_deferred",
  "duplicate",
  "excluded_action",
  "append-only",
]);
const CONFIRM_WAIT_MS = 20_000;
const COMPACT_AFTER_LINES = 6;
const DEFAULT_MIN_CONFIRMATIONS = 2;
const NONCE_SCAN_BLOCKS = 64;
const ADDR_RE = /^0x[0-9a-f]{40}$/;

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
  const launched = launchDelivery({ ...opts, env });
  void launched.settled.catch(() => {
    console.error("points_notify", "error");
  });
  return { enabled: true, scheduled: true, durable: launched.durable };
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
  return launchDelivery({ ...opts, env }).settled;
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

/**
 * Product hook for a receipt wait that sees a replacement.
 * A cancel, or a replacement that is not the same rescue call, drops the hash.
 * The same rescue contract and the same decoded call stores old hash to new hash.
 */
export function notePointsReceiptReplacement(opts, response) {
  const reason = response && response.reason;
  const tx = response && response.transaction;
  const receipt = response && response.transactionReceipt;
  const replacedBy = tx && tx.hash ? tx.hash : receipt && receipt.transactionHash;
  if (reason === "cancelled" || !replacedBy) return notePointsCancel(opts);
  let item;
  try {
    item = normalizeItem(opts.chainId, opts.txHash);
  } catch (err) {
    return Promise.reject(err);
  }
  const next = String(replacedBy).trim().toLowerCase();
  if (!TX_RE.test(next) || next === item.txHash) return notePointsCancel(opts);
  const file = pointsOutboxPath(opts.dataDir);
  return enqueueIo(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const folded = await readFold(file);
    if (folded.cancelled.has(item.txHash) || folded.delivered.has(next)) {
      return folded.cancelled.has(item.txHash) ? { cancelled: true } : { replaced: true, txHash: next };
    }
    if (folded.links.get(item.txHash) === next) return { replaced: true, txHash: next };
    const current = folded.pending.get(item.txHash) || folded.pending.get(folded.follow(item.txHash));
    const candidate = tx || { hash: next, to: receipt && receipt.to, input: "" };
    const cand = candidateFromTx({ ...candidate, hash: next });
    if (!current || !hasCallIdentity(current) || !cand || !cand.to || cand.input.length < 10) {
      await writeRecord(file, {
        op: "observe",
        txHash: item.txHash,
        replacedBy: next,
        txTo: cand && cand.to ? cand.to : undefined,
        txInput: cand && cand.input ? cand.input : undefined,
        at: stamp(opts),
      });
      return { observed: true };
    }
    if (!matchesRescue(current, candidate)) {
      await persistCancel(file, opts, item.txHash);
      return { cancelled: true };
    }
    await writeRecord(file, {
      op: "replace",
      chainId: item.chainId,
      txHash: item.txHash,
      replacedBy: next,
      at: stamp(opts),
    });
    return { replaced: true, txHash: next };
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
  const durable = enqueueWork(async () => {
    jobs = await startDelivery(opts);
  });
  const settled = durable.then(() => Promise.all(jobs)).then((counts) => ({
    enabled: true,
    sent: counts.reduce((sum, n) => sum + n, 0),
  }));
  track(settled);
  return { durable, settled };
}

function launchRetry(opts) {
  let job = Promise.resolve({ enabled: true, sent: 0 });
  const prepared = enqueueWork(async () => {
    const file = pointsOutboxPath(opts.dataDir);
    const items = await enqueueIo(async () => {
      await sweepTemps(file);
      return [...(await readState(file)).values()];
    });
    job = runPool(file, opts, items);
  });
  const settled = prepared.then(() => job);
  track(settled);
  return settled;
}

async function startDelivery(opts) {
  const item = normalizeItem(opts.chainId, opts.txHash);
  const file = pointsOutboxPath(opts.dataDir);
  const ident = identityFrom(opts);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const items = await enqueueIo(async () => {
    await sweepTemps(file);
    const folded = await readFold(file);
    const dest = folded.follow(item.txHash);
    if (!isSettled(folded, item.txHash) && !isSettled(folded, dest) && !folded.pending.has(dest)) {
      await writeRecord(file, {
        op: "enqueue",
        chainId: item.chainId,
        txHash: item.txHash,
        at: stamp(opts),
        attempts: 0,
        mineAttempts: 0,
        notFound: 0,
        ...ident,
      });
    }
    const state = await readState(file);
    const picked = [];
    for (const row of state.values()) {
      if (row.txHash === item.txHash || row.txHash === dest || !scheduledRetries.has(row.txHash)) picked.push(row);
    }
    const fresh = picked.find((row) => row.txHash === item.txHash) || picked.find((row) => row.txHash === dest);
    const rest = picked.filter((row) => row !== fresh);
    return fresh ? [fresh, ...rest] : picked;
  });
  return launchCapped(file, opts, items);
}

function launchCapped(file, opts, items) {
  const width = poolWidth(opts);
  if (items.length === 0) return [];
  let cursor = 0;
  let active = 0;
  const boxes = items.map(() => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });
  const pump = () => {
    while (cursor < items.length && active < width) {
      const index = cursor;
      cursor += 1;
      active += 1;
      Promise.resolve()
        .then(() => claim(file, opts, items[index]))
        .then(
          (count) => {
            active -= 1;
            boxes[index].resolve(count);
            pump();
          },
          (err) => {
            active -= 1;
            boxes[index].reject(err);
            pump();
          },
        );
    }
  };
  pump();
  return boxes.map((box) => box.promise);
}

async function runPool(file, opts, items) {
  const width = poolWidth(opts);
  if (items.length === 0) return { enabled: true, sent: 0 };
  let sent = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const count = await claim(file, opts, items[index]);
      sent += count;
    }
  });
  await Promise.all(workers);
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
  if (outcome.gate === "cancelled") return enqueueIo(() => persistCancel(file, opts, outcome.item.txHash));
  if (outcome.gate !== "ready") return enqueueIo(() => applyOutcome(file, opts, outcome));
  const ready = await enqueueIo(() => takeReady(file, opts, outcome));
  if (!ready) return 0;
  const result = await postIngest(opts, ready);
  return enqueueIo(() => recordPost(file, opts, ready, result));
}

async function confirmIfNeeded(opts, item) {
  if (typeof opts.confirmReceipt !== "function") return { gate: "ready", item };
  const waitMs = Number.isFinite(Number(opts.confirmWaitMs)) ? Number(opts.confirmWaitMs) : CONFIRM_WAIT_MS;
  let receipt;
  let confirmError;
  try {
    receipt = await withTimeout(Promise.resolve().then(() => opts.confirmReceipt(item.txHash)), waitMs);
  } catch (err) {
    confirmError = err;
  }
  if (receipt && receiptAccepted(receipt)) {
    const next = itemForReceipt(item, receipt);
    if (!next) return { gate: "pending", item, error: "receipt_pending", kind: "mine" };
    if (next.txHash === item.txHash) return { gate: "ready", item: next };
    return classifyOtherHash(opts, item, next.txHash);
  }
  if (receipt && !receiptAccepted(receipt)) return { gate: "rejected", item };
  const looked = await lookupMinedReplacement(opts, item);
  if (looked) return looked;
  if (confirmError && confirmError.message !== "confirm_timeout") {
    return { gate: "pending", item, error: "rpc_error", kind: "outage", alert: true };
  }
  return { gate: "pending", item, error: "receipt_pending", kind: "mine" };
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
  return {
    ...identityFrom(item),
    chainId: item.chainId,
    txHash: hash,
    attempts: 0,
    mineAttempts: 0,
    notFound: 0,
  };
}

async function classifyOtherHash(opts, item, hash) {
  if (!hasCallIdentity(item)) {
    return { gate: "pending", item, error: "unresolved", kind: "outage", alert: true };
  }
  let tx = null;
  if (typeof opts.getTx === "function") {
    try {
      tx = await opts.getTx(hash);
    } catch {
      return { gate: "pending", item, error: "rpc_error", kind: "outage", alert: true };
    }
  }
  if (!tx || !matchesRescue(item, tx)) return { gate: "cancelled", item };
  return {
    gate: "ready",
    item: replacementItem(item, tx),
    replaces: item.txHash,
  };
}

async function lookupMinedReplacement(opts, item) {
  if (!hasNonceIdentity(item) || typeof opts.lookupNonce !== "function") return null;
  let looked;
  try {
    looked = await opts.lookupNonce(item.txFrom, item.txNonce);
  } catch {
    return { gate: "pending", item, error: "rpc_error", kind: "outage", alert: true };
  }
  if (!looked || looked.status === "pending") return null;
  if (looked.status === "unresolved") {
    return { gate: "pending", item, error: "unresolved", kind: "outage", alert: true };
  }
  if (looked.status !== "found" || !looked.tx) {
    return { gate: "pending", item, error: "unresolved", kind: "outage", alert: true };
  }
  const cand = candidateFromTx(looked.tx);
  if (!cand) return { gate: "pending", item, error: "unresolved", kind: "outage", alert: true };
  if (cand.hash === item.txHash) return null;
  if (!hasCallIdentity(item) || !matchesRescue(item, looked.tx)) return { gate: "cancelled", item };
  return {
    gate: "ready",
    item: replacementItem(item, looked.tx),
    replaces: item.txHash,
  };
}

function replacementItem(item, tx) {
  const cand = candidateFromTx(tx);
  return {
    ...identityFrom(item),
    chainId: item.chainId,
    txHash: cand.hash,
    txTo: cand.to || item.txTo,
    txInput: cand.input || item.txInput,
    attempts: 0,
    mineAttempts: 0,
    notFound: 0,
  };
}

async function applyOutcome(file, opts, outcome) {
  const item = outcome.item;
  if (outcome.gate === "rejected") {
    await persistDrop(file, opts, item.txHash, "status_failed");
    return 0;
  }
  const error = outcome.error || "receipt_pending";
  const kind = outcome.kind || (error === "receipt_pending" ? "mine" : "outage");
  if (outcome.alert) console.error("points_notify", "alert", error, item.txHash);
  const counts = await noteAttempt(file, opts, item, error, kind);
  if (kind === "mine" && counts.mineAttempts >= MAX_MINE_ATTEMPTS) {
    await persistDrop(file, opts, item.txHash, "not_mined");
    return 0;
  }
  scheduleBackoff(opts, item.txHash, counts.attempts);
  return 0;
}

async function takeReady(file, opts, outcome) {
  const item = outcome.item;
  if (outcome.replaces) {
    const folded = await readFold(file);
    if (
      folded.cancelled.has(outcome.replaces) ||
      folded.cancelled.has(item.txHash) ||
      folded.delivered.has(item.txHash)
    ) {
      return null;
    }
    if (folded.links.get(outcome.replaces) !== item.txHash) {
      await writeRecord(file, {
        op: "replace",
        chainId: item.chainId,
        txHash: outcome.replaces,
        replacedBy: item.txHash,
        at: stamp(opts),
      });
    }
    const pending = await readState(file);
    if (!pending.has(item.txHash)) {
      await writeRecord(file, {
        op: "enqueue",
        chainId: item.chainId,
        txHash: item.txHash,
        at: stamp(opts),
        attempts: item.attempts || 0,
        mineAttempts: item.mineAttempts || 0,
        notFound: item.notFound || 0,
        ...identityFrom(item),
      });
    }
  }
  const pending = await readState(file);
  const folded = await readFold(file);
  if (folded.cancelled.has(item.txHash) || folded.delivered.has(item.txHash) || folded.dropped.has(item.txHash)) {
    return null;
  }
  if (!pending.has(item.txHash)) return null;
  return { ...pending.get(item.txHash), ...identityFrom(item) };
}

async function recordPost(file, opts, item, result) {
  if (result.ok) {
    await writeRecord(file, { op: "delivered", txHash: item.txHash, at: stamp(opts) });
    return 1;
  }
  if (result.permanent) {
    await persistDrop(file, opts, item.txHash, result.error);
    return 0;
  }
  if (result.alert) console.error("points_notify", "alert", result.error, item.txHash);
  const counts = await noteAttempt(file, opts, item, result.error, result.kind || "outage");
  if (result.retryLog) console.error("points_notify", "retry", result.status, counts.attempts, item.txHash);
  if (result.kind === "missing" && counts.notFound >= NOT_FOUND_ATTEMPTS) {
    await persistDrop(file, opts, item.txHash, "http_404");
    return 0;
  }
  scheduleBackoff(opts, item.txHash, counts.attempts);
  return 0;
}

async function persistDrop(file, opts, txHash, error) {
  const event = error === "not_mined" ? "not_mined" : error === "http_404" ? "not_found" : "dropped";
  console.error("points_notify", event, error === "http_404" || error === "not_mined" ? txHash : error, txHash);
  await writeRecord(file, { op: "dropped", txHash, at: stamp(opts), error });
}

function receiptAccepted(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const status = receipt.status;
  return status === "success" || status === "0x1" || status === 1;
}

async function noteAttempt(file, opts, item, error, kind) {
  const pending = await readState(file);
  const current = pending.get(item.txHash);
  const attempts = (current?.attempts || 0) + 1;
  const mineAttempts = (current?.mineAttempts || 0) + (kind === "mine" ? 1 : 0);
  const notFound = (current?.notFound || 0) + (kind === "missing" ? 1 : 0);
  await writeRecord(file, {
    op: "attempt",
    txHash: item.txHash,
    at: stamp(opts),
    error,
    attempts,
    mineAttempts,
    notFound,
  });
  return { attempts, mineAttempts, notFound };
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
      signal: fetchTimeoutMs(opts) > 0 ? AbortSignal.timeout(fetchTimeoutMs(opts)) : undefined,
    });
  } catch {
    return { ok: false, error: "network", alert: true };
  }
  if (response.status >= 200 && response.status < 300) return { ok: true };
  const code = await readErrorCode(response);
  if (response.status === 404) {
    if (code === "receipt_not_found") return { ok: false, error: "http_404", kind: "missing" };
    return { ok: false, error: "unreachable", alert: true, kind: "outage" };
  }
  if (PERMANENT_REJECTIONS.has(code)) return { ok: false, error: code, permanent: true };
  const outage =
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403 ||
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500;
  if (outage) {
    const retryLog = response.status === 401 || response.status === 429 || response.status >= 500;
    return {
      ok: false,
      error: `http_${response.status}`,
      kind: "outage",
      alert: response.status === 400 || response.status === 403,
      retryLog,
      status: response.status,
    };
  }
  return { ok: false, error: `http_${response.status}`, alert: true, kind: "outage" };
}

async function readErrorCode(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  if (text.includes("receipt_not_found")) return "receipt_not_found";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "string" && /^[a-z0-9_-]{1,64}$/.test(parsed.error)) return parsed.error;
  } catch {
    return "";
  }
  return "";
}

function fetchTimeoutMs(opts) {
  if (opts.fetchTimeoutMs === undefined || opts.fetchTimeoutMs === null || opts.fetchTimeoutMs === "") {
    return FETCH_TIMEOUT_MS;
  }
  const value = Number(opts.fetchTimeoutMs);
  if (!Number.isFinite(value) || value < 0) return FETCH_TIMEOUT_MS;
  return value;
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
    if (
    record.op === "enqueue" ||
    record.op === "dropped" ||
    record.op === "delivered" ||
    record.op === "replace" ||
    record.op === "cancel" ||
    record.op === "observe"
  ) {
    await appendDurable(file, record);
    return;
  }
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
  const folded = foldText(text);
  const kept = [];
  const at = new Date().toISOString();
  for (const [from, to] of folded.links) {
    kept.push({ op: "replace", txHash: from, replacedBy: to, at });
  }
  for (const hash of folded.cancelled) {
    kept.push({ op: "cancel", txHash: hash, at });
  }
  for (const hash of folded.delivered) {
    kept.push({ op: "delivered", txHash: hash, at });
  }
  for (const hash of folded.dropped) {
    kept.push({ op: "dropped", txHash: hash, at, error: folded.dropErrors.get(hash) || "dropped" });
  }
  for (const [hash, obs] of folded.observed) {
    if (folded.links.has(hash) || folded.cancelled.has(hash)) continue;
    const row = { op: "observe", txHash: hash, replacedBy: obs.replacedBy, at };
    if (obs.txTo) row.txTo = obs.txTo;
    if (obs.txInput) row.txInput = obs.txInput;
    kept.push(row);
  }
  for (const item of folded.pending.values()) {
    kept.push(compactEnqueue(item, at));
  }
  const next = kept.map((row) => JSON.stringify(row)).join("\n");
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
  return (await readFold(file)).pending;
}

async function readFold(file) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return emptyFold();
    throw err;
  }
  return foldText(text);
}

function emptyFold() {
  const pending = new Map();
  const links = new Map();
  const cancelled = new Set();
  const delivered = new Set();
  const dropped = new Set();
  const dropErrors = new Map();
  const observed = new Map();
  const follow = (hash) => {
    const seen = new Set();
    let current = hash;
    while (links.has(current) && !seen.has(current)) {
      seen.add(current);
      current = links.get(current);
    }
    return current;
  };
  return { pending, links, cancelled, delivered, dropped, dropErrors, observed, follow };
}

function foldText(text) {
  const folded = emptyFold();
  const { pending, links, cancelled, delivered, dropped, dropErrors, observed } = folded;
  const follow = folded.follow;
  const movePending = () => {
    for (const [key, value] of [...pending.entries()]) {
      const moved = follow(key);
      if (moved === key || cancelled.has(moved) || delivered.has(moved) || dropped.has(moved)) continue;
      pending.delete(key);
      if (!pending.has(moved)) pending.set(moved, { ...value, txHash: moved });
    }
  };
  const consider = (hash) => {
    const obs = observed.get(hash);
    if (!obs || !obs.txTo || !obs.txInput || obs.txInput.length < 10) return;
    const current = pending.get(hash);
    if (!current || !hasCallIdentity(current)) return;
    const fake = { hash: obs.replacedBy, to: obs.txTo, input: obs.txInput };
    if (matchesRescue(current, fake)) {
      if (!links.has(hash)) links.set(hash, obs.replacedBy);
      observed.delete(hash);
      movePending();
      return;
    }
    cancelled.add(hash);
    pending.delete(hash);
    observed.delete(hash);
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row.txHash !== "string") continue;
    const hash = row.txHash.trim().toLowerCase();
    if (!TX_RE.test(hash)) continue;
    if (row.op === "enqueue") {
      const dest = follow(hash);
      const ident = identityFrom(row);
      if (cancelled.has(hash) || cancelled.has(dest) || delivered.has(dest) || dropped.has(dest)) continue;
      if (!pending.has(dest)) {
        pending.set(dest, {
          chainId: Number(row.chainId),
          txHash: dest,
          attempts: Number(row.attempts) || 0,
          mineAttempts: Number(row.mineAttempts) || 0,
          notFound: Number(row.notFound) || 0,
          ...ident,
        });
      } else {
        Object.assign(pending.get(dest), ident);
      }
      consider(hash);
    } else if (row.op === "attempt") {
      const current = pending.get(hash) || pending.get(follow(hash));
      if (current) {
        current.attempts += 1;
        if (row.error === "receipt_pending") current.mineAttempts += 1;
        if (row.error === "http_404") current.notFound += 1;
      }
    } else if (row.op === "replace") {
      const next = String(row.replacedBy || "").trim().toLowerCase();
      if (!TX_RE.test(next) || next === hash) continue;
      links.set(hash, next);
      movePending();
    } else if (row.op === "observe") {
      const next = String(row.replacedBy || "").trim().toLowerCase();
      if (!TX_RE.test(next) || next === hash) continue;
      const seen = identityFrom(row);
      observed.set(hash, { replacedBy: next, txTo: seen.txTo || "", txInput: seen.txInput || "" });
      consider(hash);
    } else if (row.op === "cancel") {
      cancelled.add(hash);
      const dest = follow(hash);
      cancelled.add(dest);
      pending.delete(hash);
      pending.delete(dest);
      delivered.delete(hash);
    } else if (row.op === "delivered") {
      delivered.add(hash);
      pending.delete(hash);
    } else if (row.op === "dropped") {
      dropped.add(hash);
      if (row.error) dropErrors.set(hash, String(row.error));
      pending.delete(hash);
    }
  }
  return folded;
}

function isSettled(folded, hash) {
  const dest = folded.follow(hash);
  return (
    folded.cancelled.has(hash) ||
    folded.cancelled.has(dest) ||
    folded.delivered.has(hash) ||
    folded.delivered.has(dest) ||
    folded.dropped.has(hash) ||
    folded.dropped.has(dest)
  );
}

function compactEnqueue(item, at) {
  const row = {
    op: "enqueue",
    chainId: item.chainId,
    txHash: item.txHash,
    at,
    attempts: item.attempts,
    mineAttempts: item.mineAttempts || 0,
    notFound: item.notFound || 0,
  };
  const ident = identityFrom(item);
  return { ...row, ...ident };
}

async function persistCancel(file, opts, txHash) {
  const folded = await readFold(file);
  if (!folded.cancelled.has(txHash)) {
    await writeRecord(file, { op: "cancel", txHash, at: stamp(opts) });
    console.error("points_notify", "cancel", txHash);
  }
  return 0;
}

function identityFrom(source) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  const from = String(source.txFrom || "").trim().toLowerCase();
  if (ADDR_RE.test(from)) out.txFrom = from;
  const nonce = readNonce(source.txNonce);
  if (nonce !== null) out.txNonce = nonce;
  const to = String(source.txTo || "").trim().toLowerCase();
  if (ADDR_RE.test(to)) out.txTo = to;
  const input = String(source.txInput || source.input || "").trim().toLowerCase();
  if (/^0x[0-9a-f]*$/.test(input) && input.length >= 2) out.txInput = input;
  return out;
}

function readNonce(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function hasNonceIdentity(item) {
  return Boolean(item && item.txFrom && item.txNonce !== undefined && item.txNonce !== null);
}

function hasCallIdentity(item) {
  return Boolean(item && item.txTo && item.txInput && item.txInput.length >= 10);
}

function candidateFromTx(tx) {
  if (!tx || typeof tx !== "object") return null;
  const hash = String(tx.hash || tx.transactionHash || "").trim().toLowerCase();
  if (!TX_RE.test(hash)) return null;
  const to = tx.to ? String(tx.to).trim().toLowerCase() : "";
  const input = String(tx.input || tx.data || "").trim().toLowerCase();
  return { hash, to, input };
}

function matchesRescue(item, tx) {
  const cand = candidateFromTx(tx);
  if (!cand || !hasCallIdentity(item)) return false;
  if (!cand.to || cand.to !== String(item.txTo).toLowerCase()) return false;
  if (cand.input.slice(0, 10) !== String(item.txInput).toLowerCase().slice(0, 10)) return false;
  try {
    const left = decodeFunctionData({ abi: rescueAbi, data: item.txInput });
    const right = decodeFunctionData({ abi: rescueAbi, data: cand.input });
    if (left.functionName !== "rescueWithPermit" || right.functionName !== "rescueWithPermit") return false;
    return argsEqual(left.args, right.args);
  } catch {
    return false;
  }
}

function argsEqual(left, right) {
  if (left === right) return true;
  if (typeof left === "bigint" || typeof right === "bigint") {
    try {
      return BigInt(left) === BigInt(right);
    } catch {
      return false;
    }
  }
  if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right);
  if (typeof left === "string" && typeof right === "string") {
    return left.startsWith("0x") || right.startsWith("0x") ? left.toLowerCase() === right.toLowerCase() : left === right;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!argsEqual(left[i], right[i])) return false;
    }
    return true;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!argsEqual(left[key], right[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Finds the mined transaction at sender+nonce.
 * `pending` means that nonce is still unused. `unresolved` means the nonce was
 * mined but the transaction is outside the recent block window.
 * @param {import("viem").PublicClient} client
 */
export async function findTxAtNonce(client, from, nonce) {
  const address = String(from || "").trim();
  const parsed = readNonce(nonce);
  if (!ADDR_RE.test(address.toLowerCase()) || parsed === null) return { status: "pending" };
  const count = await client.getTransactionCount({
    address: /** @type {`0x${string}`} */ (address),
    blockTag: "latest",
  });
  if (BigInt(count) <= BigInt(parsed)) return { status: "pending" };
  const head = await client.getBlockNumber();
  const span = BigInt(NONCE_SCAN_BLOCKS);
  let start = head > span ? head - span : 0n;
  for (let n = head; n >= start; n -= 1n) {
    const block = await client.getBlock({ blockNumber: n, includeTransactions: true });
    const txs = block && block.transactions ? block.transactions : [];
    for (const tx of txs) {
      if (!tx || typeof tx === "string") continue;
      if (String(tx.from || "").toLowerCase() !== address.toLowerCase()) continue;
      if (BigInt(tx.nonce) !== BigInt(parsed)) continue;
      return { status: "found", tx };
    }
    if (n === 0n) break;
  }
  return { status: "unresolved" };
}

/**
 * Replays one rescue_ok row. A pending or already decided hash is left alone
 * so a later pass does not reset its counters or start another give-up cycle.
 * Otherwise the same sender+nonce lookup is used, or the row is skipped.
 */
export async function backfillPointsRescue(opts) {
  const env = opts.env || process.env;
  if (!pointsPushEnabled(env)) return { enabled: false, skipped: true, sent: 0 };
  const item = normalizeItem(opts.chainId, opts.txHash);
  const file = pointsOutboxPath(opts.dataDir);
  const folded = await enqueueIo(() => readFold(file));
  const dest = folded.follow(item.txHash);
  if (isSettled(folded, item.txHash) || isSettled(folded, dest) || folded.pending.has(item.txHash) || folded.pending.has(dest)) {
    return { enabled: true, skipped: true, sent: 0 };
  }
  const stored = folded.pending.get(dest);
  const ident = { ...identityFrom(opts), ...(stored ? identityFrom(stored) : {}) };
  if (!hasNonceIdentity(ident) || !hasCallIdentity(ident) || typeof opts.lookupNonce !== "function") {
    return { enabled: true, skipped: true, sent: 0 };
  }
  let looked;
  try {
    looked = await opts.lookupNonce(ident.txFrom, ident.txNonce);
  } catch {
    return { enabled: true, skipped: true, sent: 0 };
  }
  if (!looked || looked.status !== "found" || !looked.tx) return { enabled: true, skipped: true, sent: 0 };
  if (!matchesRescue(ident, looked.tx)) {
    await notePointsCancel({ chainId: item.chainId, txHash: item.txHash, dataDir: opts.dataDir, now: opts.now });
    console.error("points_notify", "cancel", item.txHash);
    return { enabled: true, skipped: true, sent: 0, cancelled: true };
  }
  const cand = candidateFromTx(looked.tx);
  await notePointsReplacement({
    chainId: item.chainId,
    txHash: item.txHash,
    replacedBy: cand.hash,
    dataDir: opts.dataDir,
    now: opts.now,
  });
  const delivered = await deliverPointsNotify({
    chainId: item.chainId,
    txHash: cand.hash,
    txFrom: ident.txFrom,
    txNonce: ident.txNonce,
    txTo: cand.to,
    txInput: cand.input,
    dataDir: opts.dataDir,
    env,
    confirmReceipt: opts.confirmReceipt,
    lookupNonce: opts.lookupNonce,
    getTx: opts.getTx,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    scheduleDelay: opts.scheduleDelay,
  });
  return { ...delivered, skipped: false };
}
