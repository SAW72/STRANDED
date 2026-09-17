import {
  createPublicClient,
  createWalletClient,
  http as viemHttp,
  keccak256,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { createRelayerApp } from "./app.mjs";
import { createKillSwitch, parseEnvFlag } from "./killSwitch.mjs";
import { createNonceStore } from "./nonceStore.mjs";
import { createRescueLog, orderLogSummary } from "./rescueLog.mjs";
import { DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS, withBroadcastRetry } from "./retry.mjs";
import { slipMinAmountOut, splitRescueAmounts } from "./quoteMath.mjs";

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
const DATA_DIR = process.env.DATA_DIR || "./data";
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const BROADCAST_MAX_ATTEMPTS = Number(process.env.BROADCAST_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
const BROADCAST_RETRY_BASE_MS = Number(process.env.BROADCAST_RETRY_BASE_MS || DEFAULT_BASE_DELAY_MS);
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

const usedNoncesAbi = [
  {
    type: "function",
    name: "usedNonces",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "used", type: "bool" }],
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

const killSwitch = createKillSwitch({ initial: parseEnvFlag(process.env.KILL_SWITCH) });
const rescueLog = createRescueLog({ dataDir: DATA_DIR });
const nonceStore = createNonceStore({
  isNonceUsed: async (user, nonce) =>
    publicClient.readContract({
      address: /** @type {`0x${string}`} */ (SWAP),
      abi: usedNoncesAbi,
      functionName: "usedNonces",
      args: [/** @type {`0x${string}`} */ (user), nonce],
    }),
});

/** Same `swapExact` encoding as `src/ArbSepoliaDemoPath.sol`. pathHash = keccak256(swapData). */
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
  const { amountSwap, feeAmount, amountRemainder } = splitRescueAmounts(
    amountIn,
    body.amountSwap !== undefined ? BigInt(body.amountSwap) : undefined,
  );
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
  const minAmountOut = slipMinAmountOut(payAmount);
  const slippageBps = 100;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const nonce = await nonceStore.reserve(user, { ttlMs: 30 * 60 * 1000 });
  const quote = {
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
    slippageBps,
    quoteSource: "mock-swap-router",
    amountRemainder: amountRemainder.toString(),
    router: ROUTER,
    pathHash,
    swapData,
    deadline: deadline.toString(),
    nonce: nonce.toString(),
    nonceReserved: true,
    live: true,
    stubRpc: false,
    swap: SWAP,
    relayer: account.address,
  };
  await rescueLog.append({ event: "quote", ...quote });
  return quote;
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

function retryLog(info) {
  console.error(
    "broadcast_retry",
    `attempt=${info.attempt}/${info.maxAttempts}`,
    `transient=${info.transient}`,
    `delayMs=${info.delayMs}`,
    info.message,
  );
}

async function submitRescue(body) {
  const started = Date.now();
  const summary = orderLogSummary(body);
  let attempts = 0;
  try {
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
    const txHash = await withBroadcastRetry(
      async (attempt) => {
        attempts = attempt;
        return walletClient.writeContract({
          address: /** @type {`0x${string}`} */ (SWAP),
          abi: rescueAbi,
          functionName: "rescueWithPermit",
          args,
        });
      },
      {
        maxAttempts: BROADCAST_MAX_ATTEMPTS,
        baseDelayMs: BROADCAST_RETRY_BASE_MS,
        log: retryLog,
      },
    );
    nonceStore.markConsumed(order.user, order.nonce);
    await rescueLog.append({
      event: "rescue_ok",
      ...summary,
      txHash,
      attempts,
      ms: Date.now() - started,
    });
    return { ok: true, txHash, stubRpc: false, attempts };
  } catch (err) {
    const error = err.error || err.message || "request_failed";
    if (error === "used_nonce" || /usednonce/i.test(String(err.revert || err.message || ""))) {
      try {
        if (body.order?.user != null && body.order?.nonce != null) {
          nonceStore.markConsumed(body.order.user, body.order.nonce);
        }
      } catch {
        /* ignore */
      }
    }
    await rescueLog.append({
      event: "rescue_error",
      ...summary,
      error: String(error),
      revert: err.revert ? String(err.revert) : undefined,
      attempts,
      ms: Date.now() - started,
    });
    throw err;
  }
}

const server = createRelayerApp({
  killSwitch,
  adminSecret: ADMIN_SECRET,
  allowedOrigins: ALLOWED_ORIGINS,
  liveStatus,
  buildQuote,
  submitRescue,
});

server.listen(PORT, HOST, () => {
  console.log(
    `relayer listening on ${HOST}:${PORT} stubRpc=false swap=${SWAP} relayer=${account.address} chain=${CHAIN_ID} paused=${killSwitch.isPaused()} dataDir=${DATA_DIR}`,
  );
});
