import { encodeFunctionData, keccak256 } from "viem";
import { AMOUNT_TOO_SMALL_MESSAGE, UPSTREAM_MESSAGE, fail } from "./httpError.mjs";
import { parseQuoteBody } from "./quoteRequest.mjs";
import { slipMinAmountOut, splitRescueAmounts } from "./quoteMath.mjs";

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
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [{ name: "amountIn", type: "uint256" }],
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

/** Same `swapExact` encoding as `src/ArbSepoliaDemoPath.sol`. pathHash = keccak256(swapData). */
export function encodeSwapData(tokenIn, amountSwap, nativeTo) {
  return encodeFunctionData({
    abi: mockRouterAbi,
    functionName: "swapExact",
    args: [tokenIn, amountSwap, nativeTo],
  });
}

export function contractCodePresent(code) {
  return Boolean(code && code !== "0x" && code !== "0x0");
}

function upstream(log, err) {
  log("relayer_upstream", err && err.name ? String(err.name) : "rpc_failed");
  return fail(502, "upstream_unavailable", UPSTREAM_MESSAGE);
}

/**
 * Quote builder. RPC is injected so tests never touch a live chain or a key.
 * @param {object} deps
 */
export function createBuildQuote(deps) {
  const publicClient = deps.publicClient;
  const nonceStore = deps.nonceStore;
  const rescueLog = deps.rescueLog;
  const tokenAddress = deps.tokenAddress;
  const feeTo = deps.feeTo;
  const router = deps.router;
  const swap = deps.swap;
  const relayerAddress = deps.relayerAddress;
  const defaultChainId = Number(deps.chainId ?? 421614);
  const log = deps.log || ((...args) => console.error(...args));

  async function readNativeOut(amountSwap) {
    try {
      const quoted = await publicClient.readContract({
        address: /** @type {`0x${string}`} */ (router),
        abi: mockRouterAbi,
        functionName: "quote",
        args: [amountSwap],
      });
      if (quoted > 0n) return { payAmount: quoted, quoteSource: "locked-demo-router" };
      return { payAmount: 0n, quoteSource: "locked-demo-router" };
    } catch (err) {
      if (err && err.error && err.status) throw err;
      // Open MockSwapRouter exposes only a fixed payAmount().
    }
    try {
      const payAmount = await publicClient.readContract({
        address: /** @type {`0x${string}`} */ (router),
        abi: mockRouterAbi,
        functionName: "payAmount",
      });
      return { payAmount, quoteSource: "mock-swap-router" };
    } catch (err) {
      throw upstream(log, err);
    }
  }

  return async function buildQuote(body) {
    const parsed = parseQuoteBody(body, { defaultChainId });
    const user = parsed.user;
    const tokenIn = parsed.tokenIn || tokenAddress;
    const amountIn = parsed.amountIn;
    if (!tokenIn) {
      throw fail(400, "invalid_address", "tokenIn must be an 0x address (20 bytes).");
    }

    let code;
    try {
      code = await publicClient.getCode({ address: /** @type {`0x${string}`} */ (tokenIn) });
    } catch (err) {
      throw upstream(log, err);
    }
    if (!contractCodePresent(code)) {
      throw fail(
        400,
        "token_not_contract",
        "tokenIn has no contract code. Use an allowlisted token contract, not a wallet address.",
      );
    }

    let bal;
    try {
      bal = await publicClient.readContract({
        address: /** @type {`0x${string}`} */ (tokenIn),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [user],
      });
    } catch (err) {
      throw upstream(log, err);
    }
    if (bal < amountIn) {
      throw fail(400, "insufficient_balance", "Amount is larger than this wallet's token balance.");
    }

    let tokenSymbol;
    let tokenDecimals;
    try {
      [tokenSymbol, tokenDecimals] = await Promise.all([
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
    } catch (err) {
      throw upstream(log, err);
    }

    let amountSwap;
    let feeAmount;
    let amountRemainder;
    try {
      ({ amountSwap, feeAmount, amountRemainder } = splitRescueAmounts(amountIn, parsed.amountSwap));
    } catch (err) {
      if (err && err.status === 400) {
        throw fail(400, "invalid_amount_split", "amountSwap + feeAmount must be < amountIn");
      }
      throw err;
    }

    const to = body.to || user;
    const nativeTo = body.nativeTo || user;
    const swapData = encodeSwapData(tokenIn, amountSwap, nativeTo);
    const pathHash = keccak256(swapData);
    const { payAmount, quoteSource } = await readNativeOut(amountSwap);
    if (payAmount <= 0n) {
      throw fail(400, "amount_too_small", AMOUNT_TOO_SMALL_MESSAGE);
    }

    let routerEth;
    try {
      routerEth = await publicClient.getBalance({
        address: /** @type {`0x${string}`} */ (router),
      });
    } catch (err) {
      throw upstream(log, err);
    }
    if (routerEth < payAmount) {
      throw fail(502, "quote_unavailable", "The swap router does not have enough native gas for this quote.");
    }

    const minAmountOut = slipMinAmountOut(payAmount);
    const slippageBps = 100;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
    const nonce = await nonceStore.reserve(user, { ttlMs: 30 * 60 * 1000 });
    const quote = {
      quoteId: keccak256(swapData).slice(0, 18),
      chainId: parsed.chainId,
      tokenIn,
      tokenSymbol: String(tokenSymbol),
      tokenDecimals: Number(tokenDecimals),
      user,
      amountIn: amountIn.toString(),
      amountSwap: amountSwap.toString(),
      feeAmount: feeAmount.toString(),
      feeTo,
      to,
      nativeTo,
      amountOut: payAmount.toString(),
      minAmountOut: minAmountOut.toString(),
      slippageBps,
      quoteSource,
      amountRemainder: amountRemainder.toString(),
      router,
      pathHash,
      swapData,
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      nonceReserved: true,
      live: true,
      stubRpc: false,
      swap,
      relayer: relayerAddress,
    };
    await rescueLog.append({ event: "quote", ...quote });
    return quote;
  };
}
