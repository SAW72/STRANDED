import {
  isRelayerTimeout,
  RESCUE_SEND_FAILED,
  RESCUE_SUBMIT_TIMEOUT,
  SIGNATURE_CANCELLED,
  SIGNATURE_FAILED,
} from "./relayerError";

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

export type BeforePostSignFailure = {
  stage: "before-post";
  signed: null;
  /** Quote and detailsConfirmed stay. The POST never started, so the nonce is not spent. */
  dropCachedQuote: false;
  signError: string;
};

export type PostingThrowReset = RescueErrorReset & { stage: "posting" };

/**
 * Catch path for onSign.
 * Before POST /v1/rescues (wallet signature reject and other pre-post throws), keep the quote.
 * After posting has started, same reset as a failed rescue: banner stays, confirm clears, quote drops.
 */
export function quoteSessionAfterSignThrow(input: {
  rescuePostAttempted: boolean;
  error: unknown;
}): BeforePostSignFailure | PostingThrowReset {
  if (!input.rescuePostAttempted) {
    return {
      stage: "before-post",
      signed: null,
      dropCachedQuote: false,
      signError: isUserRejected(input.error) ? SIGNATURE_CANCELLED : SIGNATURE_FAILED,
    };
  }
  if (isRelayerTimeout(input.error)) {
    return {
      stage: "posting",
      ...quoteSessionAfterRescueError({
        message: RESCUE_SUBMIT_TIMEOUT,
        relayerMessage: true,
      }),
    };
  }
  return {
    stage: "posting",
    ...quoteSessionAfterRescueError({
      message: RESCUE_SEND_FAILED,
      relayerMessage: true,
    }),
  };
}

function isUserRejected(error: unknown, seen = new Set<unknown>()): boolean {
  if (typeof error === "string") return /user rejected/i.test(error);
  if (!error || typeof error !== "object") return false;
  if (seen.has(error)) return false;
  seen.add(error);
  const record = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  if (record.name === "UserRejectedRequestError") return true;
  if (record.code === 4001 || record.code === "4001") return true;
  if (typeof record.message === "string" && /user rejected/i.test(record.message)) return true;
  return isUserRejected(record.cause, seen);
}

/** Drop a previous rescue error banner when the user starts another attempt. */
export function quoteSessionOnNewAttempt<T extends QuoteSubmitState>(
  submitState: T,
): T | { kind: "idle" } {
  if (submitState.kind === "error") return { kind: "idle" };
  return submitState;
}
