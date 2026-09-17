/**
 * Locked Arb Sepolia / buildathon quote math. Do not invent USD prices or floors.
 *
 *   feeAmount   = amountIn / 100          (1%)
 *   amountSwap  = amountIn / 5            (~20%, unless caller overrides)
 *   minAmountOut = payAmount * (10000-100) / 10000   (100 bps slip)
 */

/**
 * @param {bigint} amountIn
 * @param {bigint} payAmount  mock-router native payout (wei)
 * @param {bigint | undefined} amountSwapOverride
 */
/** 100 bps slip on the mock-router native payout. */
export function slipMinAmountOut(payAmount, bps = 100n) {
  return (payAmount * (10000n - bps)) / 10000n;
}

/** 1% fee and default ~20% swap slice. Independent of router payout. */
export function splitRescueAmounts(amountIn, amountSwapOverride) {
  const amountSwap = amountSwapOverride !== undefined ? amountSwapOverride : amountIn / 5n;
  const feeAmount = amountIn / 100n;
  if (amountSwap + feeAmount >= amountIn) {
    throw Object.assign(new Error("amountSwap + feeAmount must be < amountIn"), { status: 400 });
  }
  return {
    amountSwap,
    feeAmount,
    amountRemainder: amountIn - amountSwap - feeAmount,
    slippageBps: 100,
  };
}

export function lockedQuoteAmounts(amountIn, payAmount, amountSwapOverride) {
  const split = splitRescueAmounts(amountIn, amountSwapOverride);
  return {
    ...split,
    minAmountOut: slipMinAmountOut(payAmount),
  };
}
