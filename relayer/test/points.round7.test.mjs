import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, encodeEventTopics, encodeFunctionData, http as viemHttp } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { rescueAbi } from "../rescueAbi.mjs";
import {
  backfillPointsRescue,
  clearPointsRetryTimers,
  deliverPointsNotify,
  findTxAtNonce,
  notePointsCancel,
  notePointsReceiptReplacement,
  pointsOutboxPath,
  readUnresolvedPoints,
  retryPointsOutbox,
} from "../points/notify.mjs";

function runtimeSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tx() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function word() {
  return tx();
}

function rescueCall() {
  const user = `0x${"11".repeat(20)}`;
  const order = {
    user,
    tokenIn: user,
    amountIn: 1n,
    feeAmount: 1n,
    feeTo: user,
    amountSwap: 1n,
    minAmountOut: 1n,
    to: user,
    nativeTo: user,
    router: user,
    pathHash: word(),
    chainId: 84532n,
    deadline: 1n,
    nonce: 1n,
  };
  const txInput = encodeFunctionData({
    abi: rescueAbi,
    functionName: "rescueWithPermit",
    args: [order, "0xabcd", 27, word(), word(), "0xabcd"],
  });
  return {
    txFrom: `0x${"33".repeat(20)}`,
    txNonce: 7,
    txTo: `0x${"22".repeat(20)}`,
    txInput,
    txUser: user,
    sentBlock: 1000,
  };
}

function envFor(secret) {
  return { POINTS_INGEST_SECRET: secret, POINTS_API_URL: "https://points.invalid" };
}

function logClient({ count, head, logs, txs, spans, calls }) {
  return {
    async getTransactionCount() {
      return count;
    },
    async getBlockNumber() {
      return BigInt(head);
    },
    async getLogs(filter) {
      const fromBlock = BigInt(filter.fromBlock);
      const toBlock = BigInt(filter.toBlock);
      if (spans) spans.push(Number(toBlock - fromBlock + 1n));
      if (calls) calls.push(filter);
      const width = toBlock - fromBlock + 1n;
      if (filter.maxSpan && width > filter.maxSpan) throw new Error("block range too large");
      return (logs || []).filter((log) => {
        const n = BigInt(log.blockNumber);
        return n >= fromBlock && n <= toBlock;
      });
    },
    async getTransaction({ hash }) {
      return (txs || {})[String(hash).toLowerCase()] || null;
    },
  };
}

async function writeLines(dir, rows) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(pointsOutboxPath(dir), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
}

describe("round 7 lookup and ledger", { concurrency: false }, () => {
  it("skips a different sender and a different nonce before the matching call", async () => {
    const fields = rescueCall();
    const wrong = tx();
    const right = tx();
    const otherSender = `0x${"44".repeat(20)}`;
    const otherInput = rescueCall().txInput;
    const senderClient = logClient({
      count: fields.txNonce + 1,
      head: 1100,
      logs: [
        { transactionHash: wrong, blockNumber: 1010 },
        { transactionHash: right, blockNumber: 1020 },
      ],
      txs: {
        [wrong]: { hash: wrong, from: otherSender, nonce: fields.txNonce, to: fields.txTo, input: otherInput },
        [right]: { hash: right, from: fields.txFrom, nonce: fields.txNonce, to: fields.txTo, input: fields.txInput },
      },
    });
    const bySender = await findTxAtNonce(senderClient, fields.txFrom, fields.txNonce, fields);
    assert.equal(bySender.status, "found");
    assert.equal(bySender.tx.hash, right);

    const early = tx();
    const nonceClient = logClient({
      count: 9,
      head: 1100,
      logs: [
        { transactionHash: early, blockNumber: 1010 },
        { transactionHash: right, blockNumber: 1020 },
      ],
      txs: {
        [early]: { hash: early, from: fields.txFrom, nonce: 6, to: fields.txTo, input: otherInput },
        [right]: { hash: right, from: fields.txFrom, nonce: fields.txNonce, to: fields.txTo, input: fields.txInput },
      },
    });
    const byNonce = await findTxAtNonce(nonceClient, fields.txFrom, fields.txNonce, fields);
    assert.equal(byNonce.status, "found");
    assert.equal(byNonce.tx.hash, right);
  });

  it("leaves a future block unresolved and still finds the head and the chunk edges", async () => {
    const fields = rescueCall();
    let scans = 0;
    const future = logClient({
      count: fields.txNonce + 1,
      head: 990,
      logs: [{ transactionHash: tx(), blockNumber: 1000 }],
      txs: {},
      calls: { push() { scans += 1; } },
    });
    const parked = await findTxAtNonce(future, fields.txFrom, fields.txNonce, fields);
    assert.equal(parked.status, "unresolved");
    assert.equal(scans, 0);

    const atHead = tx();
    const headClient = logClient({
      count: fields.txNonce + 1,
      head: 1000,
      logs: [{ transactionHash: atHead, blockNumber: 1000 }],
      txs: {
        [atHead]: { hash: atHead, from: fields.txFrom, nonce: fields.txNonce, to: fields.txTo, input: fields.txInput },
      },
    });
    const onHead = await findTxAtNonce(headClient, fields.txFrom, fields.txNonce, { ...fields, sentBlock: 1000 });
    assert.equal(onHead.status, "found");
    assert.equal(onHead.tx.hash, atHead);

    const boundary = tx();
    const boundaryClient = logClient({
      count: fields.txNonce + 1,
      head: 5000,
      logs: [{ transactionHash: boundary, blockNumber: 3000 }],
      txs: {
        [boundary]: {
          hash: boundary,
          from: fields.txFrom,
          nonce: fields.txNonce,
          to: fields.txTo,
          input: fields.txInput,
        },
      },
    });
    const onBoundary = await findTxAtNonce(boundaryClient, fields.txFrom, fields.txNonce, fields);
    assert.equal(onBoundary.status, "found");
    assert.equal(onBoundary.tx.hash, boundary);

    const later = tx();
    const laterClient = logClient({
      count: fields.txNonce + 1,
      head: 5000,
      logs: [{ transactionHash: later, blockNumber: 3500 }],
      txs: {
        [later]: { hash: later, from: fields.txFrom, nonce: fields.txNonce, to: fields.txTo, input: fields.txInput },
      },
    });
    const onLater = await findTxAtNonce(laterClient, fields.txFrom, fields.txNonce, fields);
    assert.equal(onLater.status, "found");
    assert.equal(onLater.tx.hash, later);
  });

  it("asks for log chunks no wider than 2000 blocks", async () => {
    const fields = rescueCall();
    const spans = [];
    const client = logClient({
      count: fields.txNonce + 1,
      head: 5000,
      logs: [],
      spans,
    });
    const looked = await findTxAtNonce(client, fields.txFrom, fields.txNonce, { ...fields, sentBlock: 1 });
    assert.equal(looked.status, "absent");
    assert.ok(spans.length > 1);
    assert.equal(spans.every((span) => span <= 2000), true);
    assert.equal(spans.some((span) => span > 1000), true);
  });

  it("shrinks a log query until the provider accepts 10 blocks", async () => {
    const fields = rescueCall();
    const mined = tx();
    const spans = [];
    const client = {
      async getTransactionCount() {
        return fields.txNonce + 1;
      },
      async getBlockNumber() {
        return 80n;
      },
      async getLogs(filter) {
        const fromBlock = BigInt(filter.fromBlock);
        const toBlock = BigInt(filter.toBlock);
        const span = Number(toBlock - fromBlock + 1n);
        spans.push(span);
        if (span > 10) throw new Error("block range too large");
        if (fromBlock <= 40n && toBlock >= 40n) {
          return [{ transactionHash: mined, blockNumber: 40 }];
        }
        return [];
      },
      async getTransaction() {
        return {
          hash: mined,
          from: fields.txFrom,
          nonce: fields.txNonce,
          to: fields.txTo,
          input: fields.txInput,
        };
      },
    };
    const looked = await findTxAtNonce(client, fields.txFrom, fields.txNonce, { ...fields, sentBlock: 20 });
    assert.equal(looked.status, "found");
    assert.equal(looked.tx.hash, mined);
    assert.ok(spans.some((span) => span > 10));
    assert.ok(spans.some((span) => span <= 10));
  });

  it("stops scanning from block 0", async () => {
    const fields = rescueCall();
    let scans = 0;
    const client = logClient({
      count: fields.txNonce + 1,
      head: 400000,
      logs: [],
      calls: { push() { scans += 1; } },
    });
    const looked = await findTxAtNonce(client, fields.txFrom, fields.txNonce, { ...fields, sentBlock: 0 });
    assert.equal(looked.status, "unresolved");
    assert.equal(scans, 0);
  });

  it("sends the Rescued user topic through a real client", async () => {
    const fields = rescueCall();
    const seen = [];
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
      const list = Array.isArray(body) ? body : [body];
      const out = list.map((call) => {
        let result = "0x0";
        if (call.method === "eth_chainId") result = "0x66eee";
        else if (call.method === "eth_blockNumber") result = "0x3f2";
        else if (call.method === "eth_getTransactionCount") result = "0x8";
        else if (call.method === "eth_getLogs") {
          seen.push(call.params?.[0]?.topics || null);
          result = [];
        }
        return { jsonrpc: "2.0", id: call.id, result };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(body) ? out : out[0]));
    });
    const port = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    try {
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: viemHttp(`http://127.0.0.1:${port}`),
      });
      const looked = await findTxAtNonce(client, fields.txFrom, fields.txNonce, { ...fields, sentBlock: 900 });
      assert.equal(looked.status, "absent");
      const event = {
        type: "event",
        name: "Rescued",
        inputs: [
          { name: "user", type: "address", indexed: true },
          { name: "tokenIn", type: "address", indexed: true },
          { name: "amountIn", type: "uint256" },
          { name: "feeAmount", type: "uint256" },
          { name: "amountSwap", type: "uint256" },
          { name: "nativeOut", type: "uint256" },
          { name: "nativeTo", type: "address", indexed: true },
          { name: "to", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "relayer", type: "address" },
        ],
      };
      const expected = encodeEventTopics({
        abi: [event],
        eventName: "Rescued",
        args: { user: fields.txUser },
      });
      assert.ok(seen.length > 0);
      assert.equal(seen[0][0], expected[0]);
      assert.equal(String(seen[0][1]).toLowerCase(), String(expected[1]).toLowerCase());
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  });

  it("does not cancel an empty scan until a later pass, and not while the head is still on the sent block", async () => {
    const fields = rescueCall();
    const quiet = logClient({ count: fields.txNonce + 1, head: fields.sentBlock, logs: [] });
    const once = await findTxAtNonce(quiet, fields.txFrom, fields.txNonce, fields);
    assert.equal(once.status, "unresolved");

    const dir = await mkdtemp(join(tmpdir(), "points-absent-"));
    const secret = runtimeSecret();
    const hash = tx();
    const env = envFor(secret);
    try {
      const first = await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        ...fields,
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: () => new Promise(() => {}),
        confirmWaitMs: 5,
        lookupNonce: async () => ({ status: "absent", head: 5000n }),
        scheduleDelay: () => {},
      });
      assert.equal(first.sent, 0);
      const mid = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(mid.includes('"op":"cancel"'), false);
      const second = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: () => new Promise(() => {}),
        confirmWaitMs: 5,
        lookupNonce: async () => ({ status: "absent", head: 5000n }),
        scheduleDelay: () => {},
      });
      assert.equal(second.sent, 0);
      const done = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(done, /"op":"cancel"/);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("caps repeated lookup failures and still credits before that cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-range-cap-"));
    const secret = runtimeSecret();
    const hash = tx();
    const env = envFor(secret);
    let lookups = 0;
    const lookupNonce = () => {
      lookups += 1;
      throw new Error("block range too large");
    };
    try {
      await deliverPointsNotify({
        chainId: 84532,
        txHash: hash,
        ...rescueCall(),
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: () => new Promise(() => {}),
        confirmWaitMs: 5,
        lookupNonce,
        scheduleDelay: () => {},
      });
      for (let i = 0; i < 12; i += 1) {
        await retryPointsOutbox({
          dataDir: dir,
          env,
          fetchImpl: async () => new Response("ok", { status: 200 }),
          confirmReceipt: () => new Promise(() => {}),
          confirmWaitMs: 5,
          lookupNonce,
          scheduleDelay: () => {},
        });
      }
      assert.equal(lookups, 8);
      const stored = await readUnresolvedPoints(dir);
      assert.equal(stored.length, 1);
      assert.equal(stored[0].txHash, hash);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(text.includes('"op":"dropped"'), false);
      assert.equal(text.includes("not_mined"), false);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a high attempt count off the 404 cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-notfound-"));
    const secret = runtimeSecret();
    const hash = tx();
    const env = envFor(secret);
    await writeLines(dir, [
      { op: "enqueue", chainId: 84532, txHash: hash, attempts: 40, mineAttempts: 0, notFound: 0 },
    ]);
    const fetchImpl = async () => new Response(JSON.stringify({ ok: false, error: "receipt_not_found" }), { status: 404 });
    try {
      const first = await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay: () => {} });
      assert.equal(first.sent, 0);
      const mid = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(mid.includes('"op":"dropped"'), false);
      for (let i = 0; i < 6; i += 1) {
        await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay: () => {} });
      }
      const still = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(still.includes('"op":"dropped"'), false);
      await retryPointsOutbox({ dataDir: dir, env, fetchImpl, scheduleDelay: () => {} });
      const done = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(done, /http_404/);
      assert.match(done, /"op":"dropped"/);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels a replacement whose receipt hash is a different call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-other-hash-"));
    const secret = runtimeSecret();
    const fields = rescueCall();
    const original = tx();
    const other = tx();
    const posts = [];
    const env = envFor(secret);
    try {
      const result = await deliverPointsNotify({
        chainId: 84532,
        txHash: original,
        ...fields,
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async () => ({ status: "success", transactionHash: other }),
        getTx: async () => ({ hash: other, to: fields.txTo, input: rescueCall().txInput }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 0);
      assert.deepEqual(posts, []);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(text, /"op":"cancel"/);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels an in-process replacement that is a different call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-replaced-mismatch-"));
    const secret = runtimeSecret();
    const fields = rescueCall();
    const original = tx();
    const other = tx();
    const env = envFor(secret);
    try {
      await writeLines(dir, [{ op: "enqueue", chainId: 84532, txHash: original, attempts: 0, ...fields }]);
      const noted = await notePointsReceiptReplacement(
        { chainId: 84532, txHash: original, dataDir: dir },
        { reason: "replaced", transaction: { hash: other, to: fields.txTo, input: rescueCall().txInput } },
      );
      assert.equal(noted.cancelled, true);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(text, /"op":"cancel"/);
      assert.equal(text.includes('"op":"replace"'), false);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("links a matching observe and does not enqueue a cancelled hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-observe-"));
    const secret = runtimeSecret();
    const fields = rescueCall();
    const original = tx();
    const replacement = tx();
    const cancelled = tx();
    const posts = [];
    const env = envFor(secret);
    await writeLines(dir, [
      {
        op: "observe",
        txHash: original,
        replacedBy: replacement,
        txTo: fields.txTo,
        txInput: fields.txInput,
      },
      {
        op: "enqueue",
        chainId: 84532,
        txHash: original,
        attempts: 0,
        ...fields,
      },
    ]);
    try {
      const linked = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (hash) => ({ status: "success", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(linked.sent, 1);
      assert.deepEqual(posts, [replacement]);
      await notePointsCancel({ chainId: 84532, txHash: cancelled, dataDir: dir });
      const again = await deliverPointsNotify({
        chainId: 84532,
        txHash: cancelled,
        dataDir: dir,
        env,
        fetchImpl: async (_url, init) => {
          posts.push(JSON.parse(init.body).txHash);
          return new Response("ok", { status: 200 });
        },
        confirmReceipt: async (hash) => ({ status: "success", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(again.sent, 0);
      assert.deepEqual(posts, [replacement]);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps cancel, replace, and unresolved rows across compaction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-compact-keep-"));
    const secret = runtimeSecret();
    const fields = rescueCall();
    const from = tx();
    const to = tx();
    const cancelled = tx();
    const parked = tx();
    const extra = tx();
    const env = envFor(secret);
    await writeLines(dir, [
      { op: "replace", txHash: from, replacedBy: to },
      { op: "cancel", txHash: cancelled },
      { op: "enqueue", chainId: 84532, txHash: parked, attempts: 0, ...fields },
      { op: "unresolved", chainId: 84532, txHash: parked, ...fields },
      { op: "delivered", txHash: extra },
    ]);
    try {
      await notePointsCancel({ chainId: 84532, txHash: tx(), dataDir: dir });
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.match(text, new RegExp(`"op":"replace"[^\\n]*${from}`));
      assert.match(text, new RegExp(`"op":"cancel"[^\\n]*${cancelled}`));
      const stored = await readUnresolvedPoints(dir);
      assert.equal(stored.some((row) => row.txHash === parked), true);
      const retried = await retryPointsOutbox({
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: async (hash) => ({ status: "success", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(retried.sent, 0);
      const after = await readUnresolvedPoints(dir);
      assert.equal(after.some((row) => row.txHash === parked), true);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears an unresolved row when its replacement is delivered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-clear-unresolved-"));
    const fields = rescueCall();
    const original = tx();
    const replacement = tx();
    await writeLines(dir, [
      { op: "unresolved", chainId: 84532, txHash: original, ...fields },
      { op: "replace", txHash: original, replacedBy: replacement },
      { op: "delivered", txHash: replacement },
    ]);
    try {
      const stored = await readUnresolvedPoints(dir);
      assert.equal(stored.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("posts a legacy row from its own receipt and posts nothing for a reverted one", async () => {
    const secret = runtimeSecret();
    const env = envFor(secret);
    const legacyDir = await mkdtemp(join(tmpdir(), "points-legacy-ok-"));
    const revertDir = await mkdtemp(join(tmpdir(), "points-legacy-revert-"));
    const hash = tx();
    let lookups = 0;
    try {
      const posted = await backfillPointsRescue({
        chainId: 84532,
        txHash: hash,
        txFrom: `0x${"33".repeat(20)}`,
        txNonce: 7,
        dataDir: legacyDir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: async () => ({ status: "success", transactionHash: hash }),
        lookupNonce: () => {
          lookups += 1;
          return { status: "unresolved" };
        },
        scheduleDelay: () => {},
      });
      assert.equal(posted.sent, 1);
      assert.equal(lookups, 0);

      const reverted = await backfillPointsRescue({
        chainId: 84532,
        txHash: tx(),
        dataDir: revertDir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: async () => ({ status: "reverted" }),
        scheduleDelay: () => {},
      });
      assert.equal(reverted.sent, 0);
      const text = await readFile(pointsOutboxPath(revertDir), "utf8").catch(() => "");
      assert.equal(text.includes('"op":"delivered"'), false);
      assert.equal(text.includes("status_failed"), false);
    } finally {
      clearPointsRetryTimers();
      await rm(legacyDir, { recursive: true, force: true });
      await rm(revertDir, { recursive: true, force: true });
    }
  });

  it("posts nothing when the looked up receipt reverted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-identity-revert-"));
    const secret = runtimeSecret();
    const fields = rescueCall();
    const hash = tx();
    const env = envFor(secret);
    try {
      const result = await backfillPointsRescue({
        chainId: 84532,
        txHash: hash,
        ...fields,
        dataDir: dir,
        env,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        lookupNonce: async () => ({
          status: "found",
          tx: { hash, from: fields.txFrom, nonce: fields.txNonce, to: fields.txTo, input: fields.txInput },
        }),
        confirmReceipt: async () => ({ status: "reverted", transactionHash: hash }),
        scheduleDelay: () => {},
      });
      assert.equal(result.sent, 0);
      const text = await readFile(pointsOutboxPath(dir), "utf8");
      assert.equal(text.includes('"op":"delivered"'), false);
      assert.match(text, /status_failed/);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("wires backfill to the nonce lookup", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/backfill-points.mjs", import.meta.url)), "utf8");
    assert.match(src, /findTxAtNonce/);
    assert.match(src, /lookupNonce = \(from, nonce, hint\) => findTxAtNonce/);
  });

  it("credits eight new rescues worth of one fresh post while retries would be full", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-arr8-"));
    const secret = runtimeSecret();
    const stuck = Array.from({ length: 8 }, () => tx());
    const fresh = tx();
    const posts = [];
    const env = envFor(secret);
    const confirmReceipt = (hash) => {
      if (stuck.includes(hash)) return new Promise(() => {});
      return { status: "success", transactionHash: hash };
    };
    const base = {
      chainId: 84532,
      dataDir: dir,
      env,
      fetchImpl: async (_url, init) => {
        posts.push(JSON.parse(init.body).txHash);
        return new Response("ok", { status: 200 });
      },
      confirmReceipt,
      confirmWaitMs: 4_000,
      scheduleDelay: () => {},
    };
    const waiting = [];
    try {
      for (const hash of stuck) waiting.push(deliverPointsNotify({ ...base, txHash: hash }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      const started = Date.now();
      const result = await deliverPointsNotify({ ...base, txHash: fresh });
      const elapsed = Date.now() - started;
      console.log("arr8_credit_ms", elapsed);
      assert.equal(result.sent, 1);
      assert.ok(elapsed < 1_000, `arr8_credit_ms ${elapsed}`);
      assert.deepEqual(posts, [fresh]);
    } finally {
      clearPointsRetryTimers();
      await Promise.allSettled(waiting);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("caps retry receipt waits at four even when the pool is wider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "points-retry-cap-"));
    const secret = runtimeSecret();
    const hashes = Array.from({ length: 5 }, () => tx());
    const env = envFor(secret);
    await writeLines(
      dir,
      hashes.map((hash) => ({ op: "enqueue", chainId: 84532, txHash: hash, attempts: 0 })),
    );
    let active = 0;
    let peak = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    try {
      clearPointsRetryTimers();
      const pending = retryPointsOutbox({
        dataDir: dir,
        env,
        maxParallel: 8,
        confirmWaitMs: 400,
        fetchImpl: async () => new Response("ok", { status: 200 }),
        confirmReceipt: () => {
          active += 1;
          peak = Math.max(peak, active);
          return gate.then(() => {
            active -= 1;
            return { status: "success" };
          });
        },
        scheduleDelay: () => {},
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(peak, 4);
      assert.equal(active, 4);
      release();
      const result = await pending;
      assert.equal(result.sent, 5);
    } finally {
      clearPointsRetryTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("waits for the outbox line and keeps the receipt hook on the notify path", () => {
    const server = readFileSync(fileURLToPath(new URL("../server.mjs", import.meta.url)), "utf8");
    const resolve = readFileSync(fileURLToPath(new URL("../scripts/resolve-points.mjs", import.meta.url)), "utf8");
    const notifyAt = server.indexOf("schedulePointsNotify({");
    const durableAt = server.indexOf("if (queued.durable) await queued.durable");
    const hook = server.slice(server.indexOf("onReplaced("));
    assert.ok(notifyAt !== -1 && durableAt > notifyAt);
    assert.match(hook, /notePointsReceiptReplacement\(/);
    assert.equal(server.includes('sentBlock = "0"'), false);
    const sentCheck = resolve.indexOf("Number(result && result.sent) > 0");
    const resolvedLog = resolve.indexOf("points_resolve ${row.txHash} ${replacedBy}");
    assert.ok(sentCheck !== -1 && sentCheck < resolvedLog);
  });
});
