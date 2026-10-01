import { createPublicClient, createWalletClient, http as viemHttp, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { createRelayerApp } from "./app.mjs";
import { parseTrustedProxyHops } from "./clientIp.mjs";
import {
  INVALID_AMOUNT_MESSAGE,
  MISSING_USER_MESSAGE,
  PATH_MISMATCH_MESSAGE,
  ROUTER_NOT_ALLOWED_MESSAGE,
  asBroadcastFailure,
  fail,
  logSimulationFailure,
  simulationFailure,
} from "./httpError.mjs";
import { createKillSwitch, parseEnvFlag } from "./killSwitch.mjs";
import { createNonceStore } from "./nonceStore.mjs";
import { createBuildQuote, encodeSwapData } from "./quote.mjs";
import { createRescueLog, orderLogSummary } from "./rescueLog.mjs";
import { createRescueLimiter, parseRescueLimitConfig } from "./rescueLimit.mjs";
import { DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS, withBroadcastRetry } from "./retry.mjs";

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
const TRUSTED_PROXY_HOPS = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
// Unset means the defaults in parseRescueLimitConfig (1 wallet / 3 per IP / 4h).
const RESCUE_LIMITS = parseRescueLimitConfig(process.env);
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

const buildQuote = createBuildQuote({
  publicClient,
  nonceStore,
  rescueLog,
  tokenAddress: TOKEN,
  feeTo: FEE_TO,
  router: ROUTER,
  swap: SWAP,
  relayerAddress: account.address,
  chainId: CHAIN_ID,
});

function asOrder(raw) {
  try {
    if (!raw || typeof raw !== "object") {
      throw fail(400, "missing_user", MISSING_USER_MESSAGE);
    }
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
  } catch (err) {
    if (err && err.error && Number.isInteger(err.status)) throw err;
    throw fail(400, "invalid_amount", INVALID_AMOUNT_MESSAGE);
  }
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
      throw fail(400, "path_mismatch", PATH_MISMATCH_MESSAGE);
    }
    if (order.router.toLowerCase() !== ROUTER.toLowerCase()) {
      throw fail(400, "router_not_allowed", ROUTER_NOT_ALLOWED_MESSAGE);
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
      logSimulationFailure(err);
      throw simulationFailure(err);
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
    const raw = `${err && err.error ? err.error : ""} ${err && err.revert ? err.revert : ""} ${err && err.shortMessage ? err.shortMessage : ""} ${err && err.message ? err.message : ""}`;
    if (/used[_ ]?nonce/i.test(raw)) {
      try {
        if (body.order?.user != null && body.order?.nonce != null) {
          nonceStore.markConsumed(body.order.user, body.order.nonce);
        }
      } catch {
        /* ignore */
      }
    }
    const pub = asBroadcastFailure(err);
    const revert = err && typeof err.revert === "string" ? err.revert.slice(0, 180) : undefined;
    await rescueLog.append({
      event: "rescue_error",
      ...summary,
      error: String(pub.error || "broadcast_failed"),
      revert,
      attempts,
      ms: Date.now() - started,
    });
    throw pub;
  }
}

const rescueLimiter = createRescueLimiter({
  dataDir: DATA_DIR,
  env: process.env,
  config: RESCUE_LIMITS,
});

const server = createRelayerApp({
  killSwitch,
  adminSecret: ADMIN_SECRET,
  allowedOrigins: ALLOWED_ORIGINS,
  liveStatus,
  buildQuote,
  submitRescue,
  rescueLimiter,
  chainId: CHAIN_ID,
  trustedProxyHops: TRUSTED_PROXY_HOPS,
});

await rescueLimiter.ready;
const limitLabel = (value) => (value == null ? "off" : String(value));
server.listen(PORT, HOST, () => {
  console.log(
    `relayer listening on ${HOST}:${PORT} stubRpc=false swap=${SWAP} relayer=${account.address} chain=${CHAIN_ID} paused=${killSwitch.isPaused()} dataDir=${DATA_DIR} walletLimit=${limitLabel(RESCUE_LIMITS.perWallet)} ipLimit=${limitLabel(RESCUE_LIMITS.perIp)} windowMs=${RESCUE_LIMITS.windowMs} trustedProxyHops=${TRUSTED_PROXY_HOPS}`,
  );
});
