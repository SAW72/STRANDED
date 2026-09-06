import http from "node:http";
import {
  createPublicClient,
  createWalletClient,
  http as viemHttp,
  keccak256,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

if (process.env.RELAYER_KEY_FILE || process.env.RELAYER_PRIVATE_KEY_FILE) {
  console.error("Key files are forbidden. Export RELAYER_PRIVATE_KEY in the process environment only.");
  process.exit(1);
}

function relayerPrivateKey() {
  const raw = String(process.env.RELAYER_PRIVATE_KEY || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!raw) {
    console.error("RELAYER_PRIVATE_KEY is missing — set it in the process environment. Do not read a key file.");
    process.exit(1);
  }
  const hex = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    console.error("RELAYER_PRIVATE_KEY must be hex. Do not paste an address or mnemonic.");
    process.exit(1);
  }
  if (hex.length === 40) {
    console.error("RELAYER_PRIVATE_KEY looks like an address (20 bytes). Paste the 32-byte private key.");
    process.exit(1);
  }
  if (hex.length !== 64) {
    console.error(`RELAYER_PRIVATE_KEY must be 32 bytes (64 hex chars), got ${hex.length} hex chars.`);
    process.exit(1);
  }
  return /** @type {`0x${string}`} */ (`0x${hex}`);
}

const SWAP = process.env.GAS_RESCUE_SWAP_ADDRESS;
const RPC_URL = process.env.RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const FEE_TO = process.env.FEE_TO;
const ROUTER = process.env.ROUTER_ADDRESS;
const CHAIN_ID = Number(process.env.CHAIN_ID || 421614);
const TOKEN = process.env.TOKEN_ADDRESS;
const ALLOWED_ORIGINS = [
  process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173",
  process.env.APP_ORIGIN || "",
]
  .join(",")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (!SWAP || !FEE_TO || !ROUTER) {
  console.error("GAS_RESCUE_SWAP_ADDRESS, FEE_TO, ROUTER_ADDRESS required");
  process.exit(1);
}

const account = privateKeyToAccount(relayerPrivateKey());

const transport = viemHttp(RPC_URL, {
  fetchOptions: {
    headers: { "User-Agent": "stranded-relayer/1.0" },
  },
});
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
const walletClient = createWalletClient({
  account,
  chain: arbitrumSepolia,
  transport,
});

const mockRouterAbi = [
  {
    type: "function",
    name: "swapExact",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "payAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

const rescueAbi = [
  {
    type: "function",
    name: "rescueWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "feeAmount", type: "uint256" },
          { name: "feeTo", type: "address" },
          { name: "amountSwap", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "to", type: "address" },
          { name: "nativeTo", type: "address" },
          { name: "router", type: "address" },
          { name: "pathHash", type: "bytes32" },
          { name: "chainId", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "orderSignature", type: "bytes" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "swapData", type: "bytes" },
    ],
    outputs: [],
  },
];

function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    vary: "Origin",
  };
  const normalized = origin ? origin.replace(/\/$/, "") : "";
  if (normalized && ALLOWED_ORIGINS.includes(normalized)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function json(res, req, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("invalid_json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function encodeSwapData(tokenIn, amountSwap, nativeTo) {
  return encodeFunctionData({
    abi: mockRouterAbi,
    functionName: "swapExact",
    args: [tokenIn, amountSwap, nativeTo],
  });
}

async function liveStatus() {
  const [blockNumber, chainId, bytecode] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getChainId(),
    publicClient.getCode({ address: /** @type {`0x${string}`} */ (SWAP) }),
  ]);
  return {
    ok: true,
    live: true,
    stubRpc: false,
    chainId: Number(chainId),
    blockNumber: blockNumber.toString(),
    swap: SWAP,
    swapCode: Boolean(bytecode && bytecode !== "0x"),
    relayer: account.address,
    rpc: "live",
  };
}

async function buildQuote(body) {
  const user = body.user;
  const tokenIn = body.tokenIn || TOKEN;
  const amountIn = BigInt(body.amountIn);
  const chainId = Number(body.chainId ?? CHAIN_ID);
  if (!user || !tokenIn || amountIn <= 0n) {
    throw Object.assign(new Error("user, tokenIn, and amountIn are required"), { status: 400 });
  }
  if (chainId !== 421614) {
    throw Object.assign(new Error("this Relayer is Arb Sepolia only"), { status: 400 });
  }
  const bal = await publicClient.readContract({
    address: /** @type {`0x${string}`} */ (tokenIn),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [user],
  });
  if (bal < amountIn) {
    throw Object.assign(new Error("insufficient_balance"), { status: 400, error: "insufficient_balance" });
  }
  const [tokenSymbol, tokenDecimals] = await Promise.all([
    publicClient.readContract({
      address: /** @type {`0x${string}`} */ (tokenIn),
      abi: erc20Abi,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: /** @type {`0x${string}`} */ (tokenIn),
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  const amountSwap = body.amountSwap !== undefined ? BigInt(body.amountSwap) : amountIn / 5n;
  const feeAmount = amountIn / 100n;
  if (amountSwap + feeAmount >= amountIn) {
    throw Object.assign(new Error("amountSwap + feeAmount must be < amountIn"), { status: 400 });
  }
  const amountRemainder = amountIn - amountSwap - feeAmount;
  const to = body.to || user;
  const nativeTo = body.nativeTo || user;
  const swapData = encodeSwapData(tokenIn, amountSwap, nativeTo);
  const pathHash = keccak256(swapData);
  const payAmount = await publicClient.readContract({
    address: /** @type {`0x${string}`} */ (ROUTER),
    abi: mockRouterAbi,
    functionName: "payAmount",
  });
  if (payAmount <= 0n) {
    throw Object.assign(new Error("quote_unavailable"), { status: 502 });
  }
  const routerEth = await publicClient.getBalance({
    address: /** @type {`0x${string}`} */ (ROUTER),
  });
  if (routerEth < payAmount) {
    throw Object.assign(new Error("quote_unavailable"), { status: 502 });
  }
  const bps = 100n;
  const minAmountOut = (payAmount * (10000n - bps)) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const nonce = BigInt(Date.now());
  return {
    quoteId: keccak256(swapData).slice(0, 18),
    chainId,
    tokenIn,
    tokenSymbol: String(tokenSymbol),
    tokenDecimals: Number(tokenDecimals),
    user,
    amountIn: amountIn.toString(),
    amountSwap: amountSwap.toString(),
    feeAmount: feeAmount.toString(),
    feeTo: FEE_TO,
    to,
    nativeTo,
    amountOut: payAmount.toString(),
    minAmountOut: minAmountOut.toString(),
    slippageBps: 100,
    quoteSource: "mock-swap-router",
    amountRemainder: amountRemainder.toString(),
    router: ROUTER,
    pathHash,
    swapData,
    deadline: deadline.toString(),
    nonce: nonce.toString(),
    live: true,
    stubRpc: false,
    swap: SWAP,
    relayer: account.address,
  };
}

function asOrder(raw) {
  return {
    user: raw.user,
    tokenIn: raw.tokenIn,
    amountIn: BigInt(raw.amountIn),
    feeAmount: BigInt(raw.feeAmount),
    feeTo: raw.feeTo,
    amountSwap: BigInt(raw.amountSwap),
    minAmountOut: BigInt(raw.minAmountOut),
    to: raw.to,
    nativeTo: raw.nativeTo,
    router: raw.router,
    pathHash: raw.pathHash,
    chainId: BigInt(raw.chainId),
    deadline: BigInt(raw.deadline),
    nonce: BigInt(raw.nonce),
  };
}

async function submitRescue(body) {
  const order = asOrder(body.order);
  const swapData =
    body.swapData || encodeSwapData(order.tokenIn, order.amountSwap, order.nativeTo);
  if (keccak256(swapData) !== order.pathHash) {
    throw Object.assign(new Error("PathMismatch"), { status: 400, error: "path_mismatch" });
  }
  if (order.router.toLowerCase() !== ROUTER.toLowerCase()) {
    throw Object.assign(new Error("RouterNotAllowed"), { status: 400, error: "router_not_allowed" });
  }
  const args = [
    order,
    body.orderSignature,
    Number(body.v ?? body.permitV),
    body.r ?? body.permitR,
    body.s ?? body.permitS,
    swapData,
  ];
  try {
    await publicClient.simulateContract({
      account,
      address: /** @type {`0x${string}`} */ (SWAP),
      abi: rescueAbi,
      functionName: "rescueWithPermit",
      args,
    });
  } catch (err) {
    const name = err && (err.shortMessage || err.name || err.message);
    const revert = err && (err.data?.errorName || err.errorName || "");
    console.error("relayer_error simulation_failed", name, revert);
    throw Object.assign(new Error("simulation_failed"), {
      status: 502,
      error: "simulation_failed",
      revert: String(revert || name || "unknown"),
    });
  }
  const txHash = await walletClient.writeContract({
    address: /** @type {`0x${string}`} */ (SWAP),
    abi: rescueAbi,
    functionName: "rescueWithPermit",
    args,
  });
  return { ok: true, txHash, stubRpc: false };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "GET" && (path === "/quotes" || path === "/v1/quotes" || path === "/health")) {
      json(res, req, 200, await liveStatus());
      return;
    }
    if (req.method === "POST" && (path === "/quotes" || path === "/v1/quotes")) {
      const body = await readBody(req);
      try {
        json(res, req, 200, await buildQuote(body));
      } catch (err) {
        const error = err.error || (err.message === "insufficient_balance" ? "insufficient_balance" : "request_failed");
        json(res, req, err.status || 500, { ok: false, error });
      }
      return;
    }
    if (req.method === "POST" && path === "/v1/rescues") {
      const body = await readBody(req);
      try {
        json(res, req, 200, await submitRescue(body));
      } catch (err) {
        json(res, req, err.status || 500, {
          ok: false,
          error: err.error || "request_failed",
          revert: err.revert,
        });
      }
      return;
    }
    json(res, req, 404, { ok: false, error: "not_found" });
  } catch (err) {
    console.error("relayer_error", err instanceof Error ? err.message : "internal");
    json(res, req, 500, { ok: false, error: "request_failed" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `relayer listening on ${HOST}:${PORT} stubRpc=false swap=${SWAP} relayer=${account.address} chain=${CHAIN_ID}`,
  );
});
