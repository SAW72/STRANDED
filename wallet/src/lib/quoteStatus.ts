import {
  FIXTURE_HELP,
  QUOTE_ERROR,
  QUOTE_IDLE_AMOUNT,
  QUOTE_IDLE_CONNECT,
  QUOTE_IDLE_UNAVAILABLE,
  QUOTE_LOADING,
} from "../copy";

export type QuoteUiStatus =
  | { kind: "ready" }
  | { kind: "loading"; message: typeof QUOTE_LOADING }
  | { kind: "error"; message: typeof QUOTE_ERROR }
  | { kind: "idle"; message: string };

export function quoteUiStatus(input: {
  hasRelayer: boolean;
  connectedOnNetwork: boolean;
  hasAmount: boolean;
  fetching: boolean;
  quoteReady: boolean;
  fetchFailed: boolean;
  usingFixture: boolean;
}): QuoteUiStatus {
  if (input.quoteReady) return { kind: "ready" };
  if (input.fetching) return { kind: "loading", message: QUOTE_LOADING };
  if (input.fetchFailed) return { kind: "error", message: QUOTE_ERROR };
  if (input.usingFixture) return { kind: "idle", message: FIXTURE_HELP };
  if (!input.connectedOnNetwork) return { kind: "idle", message: QUOTE_IDLE_CONNECT };
  if (!input.hasAmount) return { kind: "idle", message: QUOTE_IDLE_AMOUNT };
  if (!input.hasRelayer) return { kind: "idle", message: FIXTURE_HELP };
  return { kind: "idle", message: QUOTE_IDLE_UNAVAILABLE };
}
