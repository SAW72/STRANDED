/**
 * Quote + signature session. After a confirmed rescue the spent Order (nonce,
 * minAmountOut, deadline) and its signatures must be dropped. Replaying them
 * hits GasRescueSwap UsedNonce; a hard refresh was the only recovery.
 */
export type QuoteSubmitState =
  | { kind: "idle" }
  | { kind: "posting" }
  | { kind: "ok"; txHash: string | null }
  | { kind: "error"; message: string; relayerMessage?: boolean };

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

export type RescueErrorReset = {
  signed: null;
  detailsConfirmed: false;
  signError: null;
  signing: false;
  /** Cached quote must be removed so the spent nonce cannot be signed again. */
  dropCachedQuote: true;
  submitState: { kind: "error"; message: string; relayerMessage?: boolean };
};

/**
 * After POST /v1/rescues fails, keep the error and force a fresh quote.
 * Sign stays off until that quote arrives and the user confirms it again.
 */
export function quoteSessionAfterRescueError(failure: {
  message: string;
  relayerMessage?: boolean;
}): RescueErrorReset {
  return {
    signed: null,
    detailsConfirmed: false,
    signError: null,
    signing: false,
    dropCachedQuote: true,
    submitState: {
      kind: "error",
      message: failure.message,
      ...(failure.relayerMessage ? { relayerMessage: true } : {}),
    },
  };
}

/** Quotes react-query prefix. removeQueries on this key so the same amountIn cannot reuse a spent nonce. */
export const QUOTES_QUERY_KEY = "quotes" as const;
