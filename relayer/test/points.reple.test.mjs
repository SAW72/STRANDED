import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeEventTopics, encodeFunctionData, keccak256, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeSwapData } from "../quote.mjs";
import { rescueAbi } from "../rescueAbi.mjs";

const USED_NONCES_SELECTOR = toFunctionSelector("function usedNonces(address user, uint256 nonce)");
const relayerRoot = fileURLToPath(new URL("..", import.meta.url));
const SWAP = `0x${"21".repeat(20)}`;
const FEE_TO = `0x${"fe".repeat(20)}`;
const ROUTER = `0x${"40".repeat(20)}`;
const USER = `0x${"11".repeat(20)}`;
const RESCUED_TOPICS = encodeEventTopics({
  abi: [
    {
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
    },
  ],
  eventName: "Rescued",
  args: { user: USER },
});

function hexWord() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function hx(n) {
  return `0x${BigInt(n).toString(16)}`;
}

function rescueInput() {
  const order = {
    user: USER,
    tokenIn: USER,
    amountIn: 1000n,
    feeAmount: 1n,
    feeTo: FEE_TO,
    amountSwap: 999n,
    minAmountOut: 1n,
    to: USER,
    nativeTo: USER,
    router: ROUTER,
    pathHash: hexWord(),
    chainId: 421614n,
    deadline: 2n ** 32n,
    nonce: 1n,
  };
  return encodeFunctionData({
    abi: rescueAbi,
    functionName: "rescueWithPermit",
    args: [order, "0xabcd", 27, hexWord(), hexWord(), "0xabcd"],
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function freePort() {
  const probe = net.createServer();
  const port = await listen(probe);
  await closeServer(probe);
  return port;
}

function startCatcher(secret) {
  const posts = [];
  const rejected = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const timestamp = String(req.headers["x-points-timestamp"] || "");
    const signature = String(req.headers["x-points-signature"] || "");
    const expected = createHmac("sha256", secret).update(`${timestamp}\n${raw}`).digest("hex");
    const presented = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const signed =
      timestamp.length > 0 &&
      presented.length === wanted.length &&
      timingSafeEqual(presented, wanted) &&
      body &&
      Number(body.chainId) === 421614 &&
      /^0x[0-9a-fA-F]{64}$/.test(String(body.txHash || ""));
    if (!signed) {
      rejected.push(raw);
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"ok":false,"error":"bad_signature"}');
      return;
    }
    posts.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  return { server, posts, rejected };
}

function startRpc(state) {
  const calls = [];
  const blockHash = (n) => `0x${n.toString(16).padStart(64, "0")}`;
  const txObj = (hash, mined, cancel) => ({
    hash,
    from: state.from,
    to: cancel ? state.from : SWAP,
    nonce: hx(state.nonce),
    value: "0x0",
    input: cancel ? "0x" : state.input,
    gas: "0x30d40",
    gasPrice: hx(1_000_000_000),
    blockNumber: mined ? hx(state.block) : null,
    blockHash: mined ? blockHash(state.block) : null,
    transactionIndex: mined ? "0x0" : null,
    type: "0x0",
    v: "0x1b",
    r: "0x1",
    s: "0x1",
    chainId: hx(421614),
  });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (state.downUntil && Date.now() < state.downUntil) {
      res.writeHead(503);
      res.end("down");
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
    const list = Array.isArray(body) ? body : [body];
    const out = list.map((call) => {
      calls.push(call.method);
      let result = null;
      let error = null;
      const method = call.method;
      if (method === "eth_chainId") result = hx(421614);
      else if (method === "eth_blockNumber") {
        if (state.bnFail < 0 || state.bnFail > 0) {
          if (state.bnFail > 0) state.bnFail -= 1;
          error = { code: -32603, message: "internal error" };
        } else result = hx(state.head);
      }
      else if (method === "eth_getBalance" || method === "eth_getTransactionCount") {
        const minedCount = state.mined ? state.nonce + 1 : state.nonce;
        result = method === "eth_getTransactionCount" ? hx(minedCount) : hx(10n ** 18n);
      } else if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") result = hx(1_000_000_000);
      else if (method === "eth_estimateGas") {
        if (state.sendMode === "mined-drop" && !state.staleEstimate && state.sentRaw.length > 0) {
          error = { code: 3, message: "execution reverted: UsedNonce" };
        } else result = "0x186a0";
      } else if (method === "eth_getCode") result = "0x60016000";
      else if (method === "eth_call") {
        const data = String((call.params && call.params[0] && call.params[0].data) || "");
        if (state.permitUsed && data.startsWith(USED_NONCES_SELECTOR)) {
          result = `0x${"00".repeat(31)}01`;
        } else if (state.sendMode === "mined-drop" && !state.staleEstimate && state.sentRaw.length > 0) {
          error = { code: 3, message: "execution reverted: UsedNonce" };
        } else result = `0x${"00".repeat(32)}`;
      } else if (method === "eth_sendRawTransaction") {
        const raw = String(call.params?.[0] || "");
        const hash = keccak256(raw);
        state.sentRaw.push(hash);
        if (state.sendMode === "mined-drop" || state.sendMode === "permit-used") {
          if (!state.droppedOnce) {
            state.droppedOnce = true;
            state.t0 = hash;
            if (state.sendMode === "mined-drop") {
              state.t1 = hash;
              state.mined = true;
            }
            state.dropBody = true;
          } else if (hash === state.t0) {
            error = { code: -32000, message: "nonce too low" };
          } else {
            state.extra = hash;
            result = hash;
          }
        } else if (state.sendMode === "resend") {
          if (state.known.has(hash)) {
            error = { code: -32000, message: "already known" };
          } else {
            state.known.add(hash);
            state.t0 = hash;
            state.dropBody = true;
          }
        } else if (state.sendMode === "nonce") {
          if (!state.nonceRetried) {
            state.nonceRetried = true;
            state.nonce += 1;
            error = { code: -32000, message: "nonce too low" };
          } else {
            state.t0 = hash;
            result = hash;
          }
        } else {
          state.t0 = hexWord();
          result = state.t0;
        }
      } else if (method === "eth_getTransactionByHash") {
        const hash = String(call.params?.[0] || "").toLowerCase();
        if (hash === String(state.t0 || "").toLowerCase() && !state.mined) result = txObj(hash, false, false);
        else if (hash === String(state.t1 || "").toLowerCase() && state.mined) result = txObj(hash, true, state.cancel);
      } else if (method === "eth_getTransactionReceipt") {
        const hash = String(call.params?.[0] || "").toLowerCase();
        if (state.mined && hash === String(state.t1 || "").toLowerCase()) {
          result = {
            status: "0x1",
            blockNumber: hx(state.block),
            blockHash: blockHash(state.block),
            transactionHash: hash,
            transactionIndex: "0x0",
            from: state.from,
            to: state.cancel ? state.from : SWAP,
            gasUsed: "0x5208",
            cumulativeGasUsed: "0x5208",
            effectiveGasPrice: hx(1_000_000_000),
            contractAddress: null,
            logsBloom: `0x${"00".repeat(256)}`,
            type: "0x0",
            logs: [],
          };
        }
      } else if (method === "eth_getBlockByNumber") {
        const tag = call.params?.[0];
        const n = tag === "latest" || tag === "pending" ? state.head : Number(BigInt(tag));
        if (Number.isInteger(n) && n >= 0 && n <= state.head) {
          const txs = [];
          if (state.mined && n === state.block) txs.push(call.params?.[1] ? txObj(state.t1, true, state.cancel) : state.t1);
          result = {
            number: hx(n),
            hash: blockHash(n),
            parentHash: blockHash(Math.max(0, n - 1)),
            timestamp: hx(1_760_000_000 + n),
            transactions: txs,
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            miner: `0x${"01".repeat(20)}`,
            difficulty: "0x0",
            totalDifficulty: "0x0",
            extraData: "0x",
            size: "0x1",
            nonce: "0x0000000000000000",
            logsBloom: `0x${"00".repeat(256)}`,
            sha3Uncles: `0x${"0".repeat(64)}`,
            stateRoot: `0x${"0".repeat(64)}`,
            receiptsRoot: `0x${"0".repeat(64)}`,
            transactionsRoot: `0x${"0".repeat(64)}`,
            uncles: [],
            baseFeePerGas: "0x1",
            mixHash: `0x${"0".repeat(64)}`,
          };
        }
      } else if (method === "eth_getLogs") {
        const filter = call.params?.[0] || {};
        const fromBlock = Number(BigInt(filter.fromBlock ?? "0x0"));
        const toBlock = Number(BigInt(filter.toBlock ?? "0x0"));
        if (Array.isArray(state.logFrom)) state.logFrom.push(fromBlock);
        if (state.mined && !state.cancel && state.block >= fromBlock && state.block <= toBlock) {
          result = [
            {
              address: SWAP,
              topics: RESCUED_TOPICS.filter((topic) => typeof topic === "string"),
              data: "0x",
              blockNumber: hx(state.block),
              transactionHash: state.t1,
              transactionIndex: "0x0",
              logIndex: "0x0",
              removed: false,
            },
          ];
        } else result = [];
      } else if (method === "eth_syncing") result = false;
      if (error) return { jsonrpc: "2.0", id: call.id, error };
      return { jsonrpc: "2.0", id: call.id, result };
    });
    if (state.dropBody) {
      state.dropBody = false;
      res.destroy();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(Array.isArray(body) ? out : out[0]));
  });
  return { server, calls };
}

function spawnServer(env) {
  const child = spawn(process.execPath, ["--import", join(relayerRoot, "test/pointsFetchShim.mjs"), "server.mjs"], {
    cwd: relayerRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = [];
  const take = (buf) => {
    for (const line of String(buf).split("\n")) {
      if (line.trim()) lines.push(line.trim());
    }
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const done = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  return { child, lines, done };
}

async function waitFor(predicate, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function signedInput(body) {
  const order = body.order;
  return encodeFunctionData({
    abi: rescueAbi,
    functionName: "rescueWithPermit",
    args: [
      {
        user: order.user,
        tokenIn: order.tokenIn,
        amountIn: BigInt(order.amountIn),
        feeAmount: BigInt(order.feeAmount),
        feeTo: order.feeTo,
        amountSwap: BigInt(order.amountSwap),
        minAmountOut: BigInt(order.minAmountOut),
        to: order.to,
        nativeTo: order.nativeTo,
        router: order.router,
        pathHash: order.pathHash,
        chainId: BigInt(order.chainId),
        deadline: BigInt(order.deadline),
        nonce: BigInt(order.nonce),
      },
      body.orderSignature,
      Number(body.v),
      body.r,
      body.s,
      body.swapData,
    ],
  });
}

function rescueBody() {
  const amount = 1000n;
  const swapData = encodeSwapData(USER, amount - 1n, USER);
  const order = {
    user: USER,
    tokenIn: USER,
    amountIn: amount.toString(),
    feeAmount: "1",
    feeTo: FEE_TO,
    amountSwap: (amount - 1n).toString(),
    minAmountOut: "1",
    to: USER,
    nativeTo: USER,
    router: ROUTER,
    pathHash: keccak256(swapData),
    chainId: "421614",
    deadline: String(2n ** 32n),
    nonce: "1",
  };
  return {
    order,
    orderSignature: "0xabcd",
    v: 27,
    r: hexWord(),
    s: hexWord(),
    swapData,
  };
}

describe("nonce replacement through server.mjs", { concurrency: false }, () => {
  it("credits the mined replacement once after a restart, and backfill does not repeat it", { timeout: 90_000 }, async () => {
    await runCase({ cancel: false });
  });

  it("logs a same-nonce self-transfer as a cancel and credits nothing", { timeout: 150_000 }, async () => {
    await runCase({ cancel: true });
  });

  it("credits one rescue mined more than 64 blocks back after a 37 second rpc outage", { timeout: 150_000 }, async () => {
    await runCase({ cancel: false, outage: true });
  });

  it("treats an already known resend as the mined rescue", { timeout: 90_000 }, async () => {
    await runBroadcast({ sendMode: "resend" });
  });

  it("signs again when the nonce is too low", { timeout: 90_000 }, async () => {
    await runBroadcast({ sendMode: "nonce" });
  });

  it("credits the mined rescue when the first send times out on a consistent node", { timeout: 120_000 }, async () => {
    await runBroadcast({ sendMode: "mined-drop", staleEstimate: false });
  });

  it("credits the mined rescue when a lagging estimate would sign another", { timeout: 120_000 }, async () => {
    await runBroadcast({ sendMode: "mined-drop", staleEstimate: true });
  });

  it("does not credit a rescue whose permit nonce was consumed by another tx", { timeout: 120_000 }, async () => {
    await runBroadcast({ sendMode: "permit-used", permitUsed: true });
  });

  it("does not store block 0 when the head read fails once", { timeout: 90_000 }, async () => {
    await runBroadcast({ bnFail: 1, head: 400_000 });
  });

  it("does not store block 0 when every head read fails", { timeout: 90_000 }, async () => {
    await runBroadcast({ bnFail: -1, head: 400_000 });
  });
});

async function runCase({ cancel, outage = false }) {
  const dir = await mkdtemp(join(tmpdir(), "points-reple-"));
  const dataDir = join(dir, "data");
  await mkdir(dataDir, { recursive: true });
  const key = `0x${randomBytes(32).toString("hex")}`;
  const account = privateKeyToAccount(key);
  const secret = randomBytes(24).toString("hex");
  const body = rescueBody();
  const input = signedInput(body);
  const state = {
    from: account.address,
    nonce: 7,
    head: 20,
    block: 30,
    input,
    mined: false,
    cancel,
    downUntil: 0,
    t0: "",
    t1: hexWord(),
    bnFail: 0,
    sendMode: "",
    sentRaw: [],
    known: new Set(),
    nonceRetried: false,
    dropBody: false,
  };
  const rpc = startRpc(state);
  const catcher = startCatcher(secret);
  const rpcPort = await listen(rpc.server);
  const pointsPort = await listen(catcher.server);
  const appPort = await freePort();
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_NO_WARNINGS: "1",
    RELAYER_PRIVATE_KEY: key,
    GAS_RESCUE_SWAP_ADDRESS: SWAP,
    FEE_TO,
    ROUTER_ADDRESS: ROUTER,
    PORT: String(appPort),
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    RPC_URL: `http://127.0.0.1:${rpcPort}/rpc`,
    CHAIN_ID: "421614",
    POINTS_INGEST_SECRET: secret,
    POINTS_API_URL: "https://points.invalid",
    QA_POINTS_TARGET: `http://127.0.0.1:${pointsPort}`,
    BROADCAST_MAX_ATTEMPTS: "1",
  };
  let first;
  let second;
  let backfill;
  try {
    first = spawnServer(baseEnv);
    const up = await waitFor(() => first.lines.some((line) => line.includes("relayer listening")), 60_000);
    assert.equal(up, true, first.lines.join("\n"));
    const posted = await fetch(`http://127.0.0.1:${appPort}/v1/rescues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await posted.json();
    assert.equal(posted.status, 200, `${posted.status} ${JSON.stringify(payload)} ${first.lines.join("\n")}`);
    const t0 = String(payload.txHash || "").toLowerCase();
    assert.match(t0, /^0x[0-9a-f]{64}$/);
    const outboxText = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8");
    const rescueText = await readFile(join(dataDir, "rescues.jsonl"), "utf8");
    const queued = outboxText
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .find((row) => row.op === "enqueue" && row.txHash === t0);
    assert.ok(queued, outboxText);
    assert.equal(queued.txFrom, account.address.toLowerCase());
    assert.equal(queued.txNonce, state.nonce);
    assert.equal(queued.txTo, SWAP.toLowerCase());
    assert.equal(queued.txInput, undefined);
    assert.equal(queued.txSelector, input.slice(0, 10).toLowerCase());
    assert.equal(queued.txInputHash, keccak256(input).toLowerCase());
    assert.equal(queued.txUser, USER.toLowerCase());
    assert.equal(queued.sentBlock, state.head);
    const logged = rescueText
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .find((row) => row.event === "rescue_ok" && String(row.txHash).toLowerCase() === t0);
    assert.ok(logged, rescueText);
    assert.equal(String(logged.txFrom).toLowerCase(), account.address.toLowerCase());
    assert.equal(String(logged.txNonce), String(state.nonce));
    assert.equal(String(logged.txTo).toLowerCase(), SWAP.toLowerCase());
    assert.equal(logged.txInput, undefined);
    assert.equal(String(logged.txSelector).toLowerCase(), input.slice(0, 10).toLowerCase());
    assert.equal(String(logged.txInputHash).toLowerCase(), keccak256(input).toLowerCase());
    assert.equal(String(logged.txUser).toLowerCase(), USER.toLowerCase());
    assert.equal(String(logged.sentBlock), String(state.head));
    if (outage) {
      state.t0 = t0;
      state.downUntil = Date.now() + 37_000;
      const opened = setTimeout(() => {
        state.downUntil = 0;
        state.mined = true;
        state.head = 120;
        state.block = 30;
      }, 37_000);
      const saw = await waitFor(
        () => catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === state.t1.toLowerCase()),
        120_000,
      );
      clearTimeout(opened);
      assert.equal(saw, true, `${first.lines.join("\n")}\nposts ${JSON.stringify(catcher.posts)}`);
      assert.equal(catcher.posts.length, 1);
      assert.equal(catcher.rejected.length, 0);
      assert.equal(String(catcher.posts[0].txHash).toLowerCase(), state.t1.toLowerCase());
      assert.equal(catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === t0), false);
      return;
    }
    first.child.kill("SIGKILL");
    await first.done;
    state.mined = true;
    state.t0 = t0;
    state.head = 120;
    state.block = 30;
    second = spawnServer(baseEnv);
    const restarted = await waitFor(() => second.lines.some((line) => line.includes("relayer listening")), 60_000);
    assert.equal(restarted, true, second.lines.join("\n"));
    if (cancel) {
      const saw = await waitFor(
        async () => {
          const text = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8").catch(() => "");
          return text.includes('"op":"cancel"') && second.lines.some((line) => line.includes("points_notify cancel") && line.includes(t0));
        },
        75_000,
      );
      assert.equal(saw, true, second.lines.join("\n"));
      assert.equal(catcher.posts.length, 0);
      assert.equal(catcher.rejected.length, 0);
      assert.equal(catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === t0), false);
      assert.equal(catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === state.t1), false);
      const text = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8");
      assert.equal(text.includes('"op":"delivered"'), false);
    } else {
      const saw = await waitFor(
        () => catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === state.t1.toLowerCase()),
        45_000,
      );
      assert.equal(saw, true, `${second.lines.join("\n")}\nposts ${JSON.stringify(catcher.posts)}`);
      assert.equal(catcher.posts.length, 1);
      assert.equal(catcher.rejected.length, 0);
      assert.equal(String(catcher.posts[0].txHash).toLowerCase(), state.t1.toLowerCase());
      assert.equal(catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === t0), false);
      const before = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8");
      assert.match(before, /"op":"replace"/);
      assert.match(before, new RegExp(state.t1.toLowerCase()));
      const deliveredT0 = before.split("\n").some((line) => line.includes('"op":"delivered"') && line.includes(t0));
      assert.equal(deliveredT0, false);
      second.child.kill("SIGTERM");
      await second.done;
      second = null;
      backfill = spawn(process.execPath, ["--import", join(relayerRoot, "test/pointsFetchShim.mjs"), "scripts/backfill-points.mjs"], {
        cwd: relayerRoot,
        env: baseEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const backfillOut = [];
      backfill.stdout.on("data", (buf) => backfillOut.push(String(buf)));
      backfill.stderr.on("data", (buf) => backfillOut.push(String(buf)));
      const exit = await new Promise((resolve) => backfill.on("exit", (code) => resolve(code)));
      assert.equal(exit, 0, backfillOut.join(""));
      const after = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8");
      const delivered = after.split("\n").filter((line) => line.includes('"op":"delivered"'));
      assert.equal(delivered.length, 1);
      assert.match(delivered[0], new RegExp(state.t1.toLowerCase()));
      assert.match(backfillOut.join(""), /points_backfill done \d+ skipped \d+ failed 0/);
      assert.equal(catcher.posts.length, 1);
      assert.equal(catcher.rejected.length, 0);
      assert.equal(String(catcher.posts[0].txHash).toLowerCase(), state.t1.toLowerCase());
    }
  } finally {
    if (first && first.child.exitCode === null && !first.child.killed) first.child.kill("SIGKILL");
    if (second && second.child.exitCode === null && !second.child.killed) second.child.kill("SIGKILL");
    if (backfill && backfill.exitCode === null) backfill.kill("SIGKILL");
    await closeServer(rpc.server);
    await closeServer(catcher.server);
    await rm(dir, { recursive: true, force: true });
  }
}

async function runBroadcast({ sendMode = "", bnFail = 0, head = 20, staleEstimate = false, permitUsed = false }) {
  const dir = await mkdtemp(join(tmpdir(), "points-bcast-"));
  const dataDir = join(dir, "data");
  await mkdir(dataDir, { recursive: true });
  const key = `0x${randomBytes(32).toString("hex")}`;
  const account = privateKeyToAccount(key);
  const secret = randomBytes(24).toString("hex");
  const body = rescueBody();
  const input = signedInput(body);
  const state = {
    from: account.address,
    nonce: 7,
    head,
    block: head + 2,
    input,
    mined: false,
    cancel: false,
    downUntil: 0,
    t0: "",
    t1: "",
    bnFail,
    sendMode,
    staleEstimate,
    permitUsed,
    sentRaw: [],
    known: new Set(),
    nonceRetried: false,
    droppedOnce: false,
    extra: undefined,
    dropBody: false,
    logFrom: [],
  };
  const rpc = startRpc(state);
  const catcher = startCatcher(secret);
  const rpcPort = await listen(rpc.server);
  const pointsPort = await listen(catcher.server);
  const appPort = await freePort();
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_NO_WARNINGS: "1",
    RELAYER_PRIVATE_KEY: key,
    GAS_RESCUE_SWAP_ADDRESS: SWAP,
    FEE_TO,
    ROUTER_ADDRESS: ROUTER,
    PORT: String(appPort),
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    RPC_URL: `http://127.0.0.1:${rpcPort}/rpc`,
    CHAIN_ID: "421614",
    POINTS_INGEST_SECRET: secret,
    POINTS_API_URL: "https://points.invalid",
    QA_POINTS_TARGET: `http://127.0.0.1:${pointsPort}`,
    BROADCAST_MAX_ATTEMPTS: "3",
    BROADCAST_RETRY_BASE_MS: "20",
  };
  let first;
  let second;
  let backfill;
  try {
    first = spawnServer(baseEnv);
    const up = await waitFor(() => first.lines.some((line) => line.includes("relayer listening")), 60_000);
    assert.equal(up, true, first.lines.join("\n"));
    const posted = await fetch(`http://127.0.0.1:${appPort}/v1/rescues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await posted.json();
    if (bnFail < 0 && posted.status !== 200) {
      const failedRescue = await readFile(join(dataDir, "rescues.jsonl"), "utf8").catch(() => "");
      const failedOutbox = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8").catch(() => "");
      assert.equal(failedRescue.includes('"sentBlock":"0"'), false);
      assert.equal(failedRescue.includes('"sentBlock":0'), false);
      assert.equal(failedOutbox.includes('"sentBlock":0'), false);
      assert.equal(failedOutbox.includes('"sentBlock":"0"'), false);
      return;
    }
    if (sendMode === "permit-used") {
      assert.equal(posted.status, 502, `${posted.status} ${JSON.stringify(payload)} ${first.lines.join("\n")}`);
      assert.equal(payload.error, "simulation_failed");
      assert.equal(payload.revert, "UsedNonce");
      assert.equal(state.sentRaw.length >= 1, true);
      assert.equal(state.sentRaw.every((hash) => hash === state.sentRaw[0]), true);
      assert.equal(state.extra, undefined);
      const rescueText = await readFile(join(dataDir, "rescues.jsonl"), "utf8").catch(() => "");
      assert.equal(rescueText.includes('"event":"rescue_ok"'), false);
      assert.equal(catcher.posts.length, 0);
      const outboxText = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8").catch(() => "");
      assert.equal(outboxText.includes('"op":"delivered"'), false);
      assert.equal(outboxText.includes('"op":"enqueue"'), false);
      return;
    }
    assert.equal(posted.status, 200, `${posted.status} ${JSON.stringify(payload)} ${first.lines.join("\n")}`);
    const t0 = String(payload.txHash || "").toLowerCase();
    assert.match(t0, /^0x[0-9a-f]{64}$/);
    const rescueText = await readFile(join(dataDir, "rescues.jsonl"), "utf8");
    assert.equal(rescueText.includes('"txInput"'), false);
    const logged = rescueText
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .find((row) => row.event === "rescue_ok");
    assert.ok(logged);
    assert.equal(String(logged.txInputHash).toLowerCase(), keccak256(input).toLowerCase());
    const outboxText = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8");
    const queued = outboxText
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .find((row) => row.op === "enqueue" && row.txHash === t0);
    assert.ok(queued, outboxText);
    assert.equal(queued.txInput, undefined);
    if (sendMode === "resend") {
      assert.equal(state.sentRaw.length >= 2, true);
      assert.equal(state.sentRaw.every((hash) => hash === t0), true);
    }
    if (sendMode === "nonce") {
      assert.equal(state.sentRaw.length >= 2, true);
      assert.notEqual(state.sentRaw[0], state.sentRaw[1]);
      assert.equal(t0, state.sentRaw[state.sentRaw.length - 1]);
    }
    if (sendMode === "mined-drop") {
      assert.equal(state.extra, undefined);
      assert.equal(state.sentRaw.length >= 2, true);
      assert.equal(state.sentRaw.every((hash) => hash === t0), true);
      assert.equal(String(logged.txNonce), "7");
    }
    if (bnFail === 1) {
      assert.equal(String(logged.sentBlock), String(head));
      assert.equal(queued.sentBlock, head);
    }
    if (bnFail < 0 || bnFail > 1) {
      assert.equal(logged.sentBlock, undefined);
      assert.equal(queued.sentBlock, undefined);
      assert.equal(outboxText.includes('"sentBlock":0'), false);
      assert.equal(outboxText.includes('"sentBlock":"0"'), false);
    }
    assert.equal(state.logFrom.includes(0), false);
    if (sendMode) {
      state.t1 = t0;
      state.mined = true;
      state.block = head + 2;
      state.head = head + 8;
      const saw = await waitFor(
        () => catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === t0),
        40_000,
      );
      assert.equal(saw, true, `${first.lines.join("\n")}\nposts ${JSON.stringify(catcher.posts)}`);
      assert.equal(catcher.posts.length, 1);
      if (sendMode === "mined-drop") {
        const delivered = await waitFor(async () => {
          const text = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8").catch(() => "");
          return text.includes('"op":"delivered"') && text.includes(t0);
        }, 10_000);
        assert.equal(delivered, true);
        first.child.kill("SIGTERM");
        await first.done;
        first = null;
        second = spawnServer(baseEnv);
        const restarted = await waitFor(() => second.lines.some((line) => line.includes("relayer listening")), 60_000);
        assert.equal(restarted, true, second.lines.join("\n"));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        assert.equal(catcher.posts.length, 1);
        second.child.kill("SIGTERM");
        await second.done;
        second = null;
        backfill = spawn(process.execPath, ["--import", join(relayerRoot, "test/pointsFetchShim.mjs"), "scripts/backfill-points.mjs"], {
          cwd: relayerRoot,
          env: baseEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const backfillOut = [];
        backfill.stdout.on("data", (buf) => backfillOut.push(String(buf)));
        backfill.stderr.on("data", (buf) => backfillOut.push(String(buf)));
        const exit = await new Promise((resolve) => backfill.on("exit", (code) => resolve(code)));
        assert.equal(exit, 0, backfillOut.join(""));
        const after = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8");
        const deliveredRows = after.split("\n").filter((line) => line.includes('"op":"delivered"'));
        assert.equal(deliveredRows.length, 1);
        assert.match(deliveredRows[0], new RegExp(t0));
        assert.equal(catcher.posts.length, 1);
        assert.equal(catcher.posts.some((row) => String(row.txHash || "").toLowerCase() === t0), true);
      }
    }
  } finally {
    if (first && first.child.exitCode === null && !first.child.killed) first.child.kill("SIGKILL");
    if (second && second.child.exitCode === null && !second.child.killed) second.child.kill("SIGKILL");
    if (backfill && backfill.exitCode === null) backfill.kill("SIGKILL");
    await closeServer(rpc.server);
    await closeServer(catcher.server);
    await rm(dir, { recursive: true, force: true });
  }
}
