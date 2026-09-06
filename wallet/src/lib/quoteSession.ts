/**
 * Quote + signature session. After a confirmed rescue the spent Order (nonce,
 * minAmountOut, deadline) and its signatures must be dropped. Replaying them
 * hits GasRescueSwap UsedNonce; a hard refresh was the only recovery.
 */
export type QuoteSubmitState =
  | { kind: "idle" }
  | { kind: "posting" }
  | { kind: "ok"; txHash: string | null }
  | { kind: "error"; message: string };

export type QuoteSessionSlice = {
  signed: null;
  detailsConfirmed: false;
  submitState: { kind: "idle" };
  signError: null;
  signing: false;
};

export function quoteSessionAfterRescueSuccess(): QuoteSessionSlice {
  return {
    signed: null,
    detailsConfirmed: false,
    submitState: { kind: "idle" },
    signError: null,
    signing: false,
  };
}

/** Quotes react-query prefix. removeQueries on this key so the same amountIn cannot reuse a spent nonce. */
export const QUOTES_QUERY_KEY = "quotes" as const;
