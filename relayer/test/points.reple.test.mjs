import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeSwapData } from "../quote.mjs";
import { rescueAbi } from "../rescueAbi.mjs";

const relayerRoot = fileURLToPath(new URL("..", import.meta.url));
const SWAP = `0x${"21".repeat(20)}`;
const FEE_TO = `0x${"fe".repeat(20)}`;
const ROUTER = `0x${"40".repeat(20)}`;
const USER = `0x${"11".repeat(20)}`;

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

function startCatcher() {
  const posts = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      posts.push(JSON.parse(raw));
    } catch {
      posts.push({ raw });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  return { server, posts, port: null };
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
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
    const list = Array.isArray(body) ? body : [body];
    const out = list.map((call) => {
      calls.push(call.method);
      let result = null;
      const method = call.method;
      if (method === "eth_chainId") result = hx(421614);
      else if (method === "eth_blockNumber") result = hx(state.head);
      else if (method === "eth_getBalance" || method === "eth_getTransactionCount") {
        const minedCount = state.mined ? state.nonce + 1 : state.nonce;
        result = method === "eth_getTransactionCount" ? hx(minedCount) : hx(10n ** 18n);
      } else if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") result = hx(1_000_000_000);
      else if (method === "eth_estimateGas") result = "0x186a0";
      else if (method === "eth_call" || method === "eth_getCode") result = method === "eth_getCode" ? "0x60016000" : `0x${"00".repeat(32)}`;
      else if (method === "eth_sendRawTransaction") {
        state.t0 = hexWord();
        result = state.t0;
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
      } else if (method === "eth_syncing") result = false;
      return { jsonrpc: "2.0", id: call.id, result };
    });
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

  it("logs a same-nonce self-transfer as a cancel and credits nothing", { timeout: 90_000 }, async () => {
    await runCase({ cancel: true });
  });
});

async function runCase({ cancel }) {
  const dir = await mkdtemp(join(tmpdir(), "points-reple-"));
  const dataDir = join(dir, "data");
  await mkdir(dataDir, { recursive: true });
  const key = `0x${randomBytes(32).toString("hex")}`;
  const account = privateKeyToAccount(key);
  const secret = randomBytes(24).toString("hex");
  const input = rescueInput();
  const state = {
    from: account.address,
    nonce: 7,
    head: 40,
    block: 36,
    input,
    mined: false,
    cancel,
    t0: "",
    t1: hexWord(),
  };
  const rpc = startRpc(state);
  const catcher = startCatcher();
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
    const up = await waitFor(() => first.lines.some((line) => line.includes("relayer listening")), 10_000);
    assert.equal(up, true, first.lines.join("\n"));
    const posted = await fetch(`http://127.0.0.1:${appPort}/v1/rescues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rescueBody()),
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
    assert.equal(queued.txInput, input.toLowerCase());
    const logged = rescueText
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .find((row) => row.event === "rescue_ok" && String(row.txHash).toLowerCase() === t0);
    assert.ok(logged, rescueText);
    assert.equal(String(logged.txFrom).toLowerCase(), account.address.toLowerCase());
    assert.equal(String(logged.txNonce), String(state.nonce));
    assert.equal(Object.hasOwn(logged, "txInput"), false);
    first.child.kill("SIGKILL");
    await first.done;
    state.mined = true;
    state.t0 = t0;
    second = spawnServer(baseEnv);
    const restarted = await waitFor(() => second.lines.some((line) => line.includes("relayer listening")), 10_000);
    assert.equal(restarted, true, second.lines.join("\n"));
    if (cancel) {
      const saw = await waitFor(
        async () => {
          const text = await readFile(join(dataDir, "points-outbox.jsonl"), "utf8").catch(() => "");
          return text.includes('"op":"cancel"') && second.lines.some((line) => line.includes("points_notify cancel") && line.includes(t0));
        },
        45_000,
      );
      assert.equal(saw, true, second.lines.join("\n"));
      assert.equal(catcher.posts.length, 0);
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
      assert.equal(after, before);
      assert.equal(catcher.posts.length, 1);
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
