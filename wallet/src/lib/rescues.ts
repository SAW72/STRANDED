import { isAddress, isHex, type Hex } from "viem";
import type { RescueOrder } from "./order";

export type RescueSubmitInput = {
  chainId: number;
  order: RescueOrder;
  orderSignature: Hex;
  permitV: number;
  permitR: Hex;
  permitS: Hex;
  swapData?: Hex;
};

export type RescueSubmitResult =
  | { ok: true; txHash: Hex | null; stubRpc: boolean }
  | { ok: false; reason: string };

export function rescuesUrl(relayerBase: string): string {
  const base = relayerBase.replace(/\/$/, "");
  return `${base}/v1/rescues`;
}

export function rescueRequestBody(input: RescueSubmitInput): Record<string, unknown> {
  const { order } = input;
  const body: Record<string, unknown> = {
    chainId: input.chainId,
    order: {
      user: order.user,
      tokenIn: order.tokenIn,
      amountIn: order.amountIn.toString(),
      feeAmount: order.feeAmount.toString(),
      feeTo: order.feeTo,
      amountSwap: order.amountSwap.toString(),
      minAmountOut: order.minAmountOut.toString(),
      to: order.to,
      nativeTo: order.nativeTo,
      router: order.router,
      pathHash: order.pathHash,
      chainId: order.chainId.toString(),
      deadline: order.deadline.toString(),
      nonce: order.nonce.toString(),
    },
    orderSignature: input.orderSignature,
    v: input.permitV,
    r: input.permitR,
    s: input.permitS,
  };
  if (input.swapData) body.swapData = input.swapData;
  return body;
}

function parseTxHash(value: unknown): Hex | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isHex(trimmed) || trimmed.length !== 66) return null;
  return trimmed;
}

function asErrorBody(body: unknown): { error: string; revert: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "", revert: "" };
  }
  const obj = body as Record<string, unknown>;
  return {
    error: typeof obj.error === "string" ? obj.error : "",
    revert: typeof obj.revert === "string" ? obj.revert : "",
  };
}

/** Map Relayer POST /v1/rescues failure JSON into a visible reason. Never swallows the error code. */
export function publicSubmitError(status: number, body: unknown): string {
  const { error, revert } = asErrorBody(body);
  if (status === 404 || error === "not_found") {
    return "Relayer POST /v1/rescues is not available.";
  }
  if (error === "insufficient_balance") {
    return "Amount is larger than this wallet's token balance. Request a fresh quote for the remaining balance.";
  }
  if (error === "used_nonce") {
    return "This quote was already used on-chain. Request a fresh quote.";
  }
  if (error === "simulation_failed" && /0x4b800e46|ERC2612InvalidSigner/i.test(revert)) {
    return "Permit signature does not match this token (wrong name or nonce). Sign again.";
  }
  if (error === "simulation_failed" && /0x81ceff30|SwapFailed/i.test(revert)) {
    return "The mock swap router is out of native gas, so the swap cannot pay out. Rescue was not broadcast.";
  }
  if (error === "simulation_failed" && revert) {
    return `Relayer POST /v1/rescues HTTP ${status} simulation_failed (${revert}). Rescue was not broadcast.`;
  }
  if (error === "simulation_failed") {
    return `Relayer POST /v1/rescues HTTP ${status} simulation_failed. Rescue was not broadcast.`;
  }
  if (error) {
    return `Relayer POST /v1/rescues HTTP ${status} ${error}.`;
  }
  return `Relayer POST /v1/rescues returned HTTP ${status}.`;
}

/**
 * POST signed Order + permit to Relayer /v1/rescues.
 * Fail closed: never invents a tx hash. Caller must not POST fixture signatures.
 */
export async function submitRescue(
  relayerBase: string,
  input: RescueSubmitInput,
  fetchImpl: typeof fetch = fetch,
): Promise<RescueSubmitResult> {
  if (!relayerBase.trim()) {
    return { ok: false, reason: "VITE_RELAYER_URL is not set." };
  }
  if (!isAddress(input.order.user) || !isHex(input.orderSignature)) {
    return { ok: false, reason: "Signed rescue is incomplete." };
  }

  const source = rescuesUrl(relayerBase);
  console.info("[rescue] POST /v1/rescues", {
    url: source,
    user: input.order.user,
    tokenIn: input.order.tokenIn,
    amountIn: input.order.amountIn.toString(),
    nonce: input.order.nonce.toString(),
  });
  let response: Response;
  try {
    response = await fetchImpl(source, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(rescueRequestBody(input)),
    });
  } catch (err) {
    const reason = `Could not reach Relayer POST /v1/rescues at ${relayerBase}.`;
    console.error("[rescue] POST /v1/rescues network error", err);
    return { ok: false, reason };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const reason = publicSubmitError(response.status, body);
    console.error("[rescue] POST /v1/rescues failed", {
      status: response.status,
      body,
      reason,
    });
    return { ok: false, reason };
  }

  const obj = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!obj || obj.ok !== true) {
    const reason = "Relayer did not accept the signed rescue.";
    console.error("[rescue] POST /v1/rescues rejected", { status: response.status, body, reason });
    return { ok: false, reason };
  }
  const txHash = parseTxHash(obj.txHash);
  console.info("[rescue] POST /v1/rescues ok", { txHash, stubRpc: obj.stubRpc === true });
  return { ok: true, txHash, stubRpc: obj.stubRpc === true };
}
