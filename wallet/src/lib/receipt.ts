import type { Hex } from "viem";
import type { RescueQuote } from "./quotes";
import type { RescueSubmitResult } from "./rescues";

/** Frozen receipt shown after a successful POST /v1/rescues. Independent of a later quote refetch. */
export type RescueReceiptView = {
  txHash: Hex | null;
  stubRpc: boolean;
  chainId: number;
  tokenSymbol: string;
  tokenDecimals: number;
  amountSwap: bigint;
  gasReceived: bigint;
  feeAmount: bigint;
  amountRemainder: bigint;
};

export const RECEIPT_FIELDS = [
  "txHash",
  "amountSwap",
  "gasReceived",
  "feeAmount",
  "amountRemainder",
] as const;

export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

/**
 * Build a receipt from the signed quote plus a successful Relayer response.
 * Returns null when the POST did not succeed — never invents a tx hash.
 */
export function receiptFromSubmit(
  quote: RescueQuote,
  result: RescueSubmitResult,
): RescueReceiptView | null {
  if (!result.ok) return null;
  return {
    txHash: result.txHash,
    stubRpc: result.stubRpc,
    chainId: quote.chainId,
    tokenSymbol: quote.tokenSymbol,
    tokenDecimals: quote.tokenDecimals,
    amountSwap: quote.amountSwap,
    gasReceived: quote.amountOut ?? quote.minAmountOut,
    feeAmount: quote.feeAmount,
    amountRemainder: quote.amountRemainder,
  };
}
