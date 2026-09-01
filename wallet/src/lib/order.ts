import { type Address, type Hex, parseSignature } from "viem";
import type { RescueQuote } from "./quotes";

export const EIP712_DOMAIN_NAME = "StewardGasRescue";
export const EIP712_DOMAIN_VERSION = "1";

export const ORDER_TYPES = {
  Order: [
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
} as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type RescueOrder = {
  user: Address;
  tokenIn: Address;
  amountIn: bigint;
  feeAmount: bigint;
  feeTo: Address;
  amountSwap: bigint;
  minAmountOut: bigint;
  to: Address;
  nativeTo: Address;
  router: Address;
  pathHash: Hex;
  chainId: bigint;
  deadline: bigint;
  nonce: bigint;
};

export function gasRescueDomain(verifyingContract: Address, chainId: number) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

export function permitDomain(tokenName: string, verifyingContract: Address, chainId: number) {
  return {
    name: tokenName,
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

/** Build the EIP-712 Order from a complete quote. Does not invent missing legs. */
export function buildOrder(params: { quote: RescueQuote }): RescueOrder {
  const { quote } = params;
  return {
    user: quote.user,
    tokenIn: quote.tokenIn,
    amountIn: quote.amountIn,
    feeAmount: quote.feeAmount,
    feeTo: quote.feeTo,
    amountSwap: quote.amountSwap,
    minAmountOut: quote.minAmountOut,
    to: quote.to,
    nativeTo: quote.nativeTo,
    router: quote.router,
    pathHash: quote.pathHash,
    chainId: BigInt(quote.chainId),
    deadline: quote.deadline,
    nonce: quote.nonce,
  };
}

export function splitPermitSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const parsed = parseSignature(signature);
  const v = parsed.v ?? (parsed.yParity === 0 ? 27 : 28);
  return { v: Number(v), r: parsed.r, s: parsed.s };
}
