import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ARB_SEPOLIA_ONLY, BASE_SEPOLIA_ONLY } from "../httpError.mjs";
import { assertOrderChain, assertRpcChainId, parseExplicitChainId } from "../quoteRequest.mjs";
import { req, withServer } from "./harness.mjs";

const relayerRoot = path.resolve(import.meta.dirname, "..");
const USER = "0x1111111111111111111111111111111111111111";
const ORIGIN = "http://localhost:5173";
// Public Anvil/Hardhat account. Not a relayer secret.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function rpcServer(onChainId) {
  const server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (chunk) => {
      buf += chunk;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(buf || "{}");
      } catch {
        body = {};
      }
      const items = Array.isArray(body) ? body : [body];
      const out = items.map((item) => {
        if (item && item.method === "eth_chainId") return onChainId(item);
        return { jsonrpc: "2.0", id: item && item.id, error: { code: -32601, message: "unexpected" } };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(body) ? out : out[0]));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function chainResult(hex) {
  return (item) => ({ jsonrpc: "2.0", id: item.id, result: hex });
}

function chainError() {
  return (item) => ({ jsonrpc: "2.0", id: item.id, error: { code: -32000, message: "rpc down" } });
}

async function launch(env) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "relayer-chain-"));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: relayerRoot,
    env: {
      RELAYER_PRIVATE_KEY: TEST_KEY,
      GAS_RESCUE_SWAP_ADDRESS: "0x65e712222745A8FCCbF038A90Fa75caB0867993D",
      FEE_TO: "0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D",
      ROUTER_ADDRESS: "0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc",
      PORT: "0",
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk) => {
    err += chunk;
  });
  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish("timeout"), 8000);
    child.on("exit", (code) => finish(code));
    const watch = () => {
      if (out.includes("relayer listening")) finish("listening");
    };
    child.stdout.on("data", watch);
  });
  if (child.exitCode === null) child.kill("SIGKILL");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.on("exit", () => resolve());
  });
  await rm(dataDir, { recursive: true, force: true });
  return { outcome, out, err };
}

describe("parseExplicitChainId", () => {
  it("accepts the two testnet decimals", () => {
    assert.equal(parseExplicitChainId("421614"), 421614);
    assert.equal(parseExplicitChainId("84532"), 84532);
    assert.equal(parseExplicitChainId("421614\n"), 421614);
  });

  it("startup rejects a missing CHAIN_ID", async () => {
    const rpc = await rpcServer(chainResult("0x66eee"));
    try {
      const { port } = rpc.address();
      const started = await launch({ RPC_URL: `http://127.0.0.1:${port}` });
      assert.equal(started.out.includes("relayer listening"), false);
      assert.equal(started.outcome, 1);
      assert.match(started.err, /decimal string/);
      assert.equal(started.err.includes("421614"), false);
    } finally {
      await new Promise((resolve) => rpc.close(resolve));
    }
  });

  it("parseExplicitChainId rejects a non-decimal CHAIN_ID", () => {
    for (const raw of [undefined, null, "", "   ", "0x66eee", "421614.0", "421614abc", "0421614", "+421614"]) {
      assert.throws(() => parseExplicitChainId(raw), /CHAIN_ID must be/);
    }
    assert.throws(() => parseExplicitChainId("1"), /421614 \(Arb Sepolia\) or 84532/);
  });

  it("startup rejects a non-decimal CHAIN_ID", async () => {
    const rpc = await rpcServer(chainResult("0x66eee"));
    try {
      const { port } = rpc.address();
      const started = await launch({ CHAIN_ID: "0x66eee", RPC_URL: `http://127.0.0.1:${port}` });
      assert.equal(started.out.includes("relayer listening"), false);
      assert.equal(started.outcome, 1);
      assert.match(started.err, /decimal string/);
    } finally {
      await new Promise((resolve) => rpc.close(resolve));
    }
  });
});

describe("RPC eth_chainId startup check", () => {
  it("assertRpcChainId requires an exact integer match", () => {
    assert.doesNotThrow(() => assertRpcChainId(421614, 421614));
    assert.doesNotThrow(() => assertRpcChainId(84532n, 84532));
    assert.throws(() => assertRpcChainId(1, 421614), /does not match CHAIN_ID 421614/);
    assert.throws(() => assertRpcChainId("nope", 84532), /does not match/);
  });

  it("startup rejects an RPC chain mismatch", async () => {
    const rpc = await rpcServer(chainResult("0x1"));
    try {
      const { port } = rpc.address();
      const started = await launch({ CHAIN_ID: "421614", RPC_URL: `http://127.0.0.1:${port}` });
      assert.equal(started.out.includes("relayer listening"), false);
      assert.equal(started.outcome, 1);
      assert.match(started.err, /does not match CHAIN_ID 421614/);
    } finally {
      await new Promise((resolve) => rpc.close(resolve));
    }
  });

  it("startup rejects an RPC eth_chainId error", async () => {
    const rpc = await rpcServer(chainError());
    try {
      const { port } = rpc.address();
      const started = await launch({ CHAIN_ID: "84532", RPC_URL: `http://127.0.0.1:${port}` });
      assert.equal(started.out.includes("relayer listening"), false);
      assert.equal(started.outcome, 1);
    } finally {
      await new Promise((resolve) => rpc.close(resolve));
    }
  });

  it("startup listens only when eth_chainId matches CHAIN_ID", async () => {
    const arb = await rpcServer(chainResult("0x66eee"));
    const base = await rpcServer(chainResult("0x14a34"));
    try {
      const arbPort = arb.address().port;
      const basePort = base.address().port;
      const arbStart = await launch({ CHAIN_ID: "421614", RPC_URL: `http://127.0.0.1:${arbPort}` });
      assert.equal(arbStart.outcome, "listening");
      const baseStart = await launch({ CHAIN_ID: "84532", RPC_URL: `http://127.0.0.1:${basePort}` });
      assert.equal(baseStart.outcome, "listening");
      const crossed = await launch({ CHAIN_ID: "84532", RPC_URL: `http://127.0.0.1:${arbPort}` });
      assert.equal(crossed.out.includes("relayer listening"), false);
      assert.equal(crossed.outcome, 1);
    } finally {
      await new Promise((resolve) => arb.close(resolve));
      await new Promise((resolve) => base.close(resolve));
    }
  });
});

describe("rescue order chainId", () => {
  it("order with no chainId is wrong_chain", async () => {
    assert.throws(
      () => assertOrderChain({ order: { user: USER } }, { defaultChainId: 421614 }),
      (err) => err.error === "wrong_chain" && err.publicMessage === ARB_SEPOLIA_ONLY,
    );
    assert.throws(
      () => assertOrderChain({ order: { user: USER, chainId: "" } }, { defaultChainId: 84532 }),
      (err) => err.error === "wrong_chain" && err.publicMessage === BASE_SEPOLIA_ONLY,
    );
    assert.doesNotThrow(() => assertOrderChain({ order: { user: USER, chainId: 84532 } }, { defaultChainId: 84532 }));

    await withServer({}, async ({ url, rescueCalls }) => {
      const missing = await req(url, "/v1/rescues", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ order: { user: USER } }),
      });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.error, "wrong_chain");
      assert.equal(missing.body.message, ARB_SEPOLIA_ONLY);
      assert.equal(rescueCalls(), 0);

      const quoted = await req(url, "/v1/quotes", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ user: USER, amountIn: "1" }),
      });
      assert.equal(quoted.status, 200);

      const present = await req(url, "/v1/rescues", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ order: { user: USER, chainId: 421614 } }),
      });
      assert.equal(present.status, 200);
      assert.equal(rescueCalls(), 1);
    });

    await withServer({ chainId: 84532 }, async ({ url, rescueCalls }) => {
      const missing = await req(url, "/v1/rescues", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ order: { user: USER, chainId: null } }),
      });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.error, "wrong_chain");
      assert.equal(missing.body.message, BASE_SEPOLIA_ONLY);
      assert.equal(rescueCalls(), 0);
    });
  });
});
