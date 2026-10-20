/** 0.1 gwei. Above the usual Arb Sepolia base fee when the block read fails. */
const FEE_FLOOR = 100_000_000n;

/**
 * Bid at least twice the latest base fee. Arb Sepolia base fees sit near
 * 0.02 gwei and move between the wallet estimate and the send.
 */
export function arbDripFees(baseFeePerGas: bigint | null | undefined): {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
} {
  const base = baseFeePerGas && baseFeePerGas > 0n ? baseFeePerGas : FEE_FLOOR;
  const doubled = base * 2n;
  return {
    maxFeePerGas: doubled > FEE_FLOOR ? doubled : FEE_FLOOR,
    maxPriorityFeePerGas: 0n,
  };
}

export function dripErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : "";
  if (text.includes("max fee per gas less than block base fee")) {
    return "The gas bid was below the current block. Press Get 2 tDEMO again.";
  }
  if (text.includes("FaucetEmpty")) return "The faucet is empty.";
  if (text.includes("DripCooldown")) return "This wallet already took tDEMO in the last 24 hours.";
  return text || "The faucet did not send tokens.";
}
