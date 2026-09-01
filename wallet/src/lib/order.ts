import { type Address, type Hex, parseSignature } from "viem";
import type { RescueQuote } from "./quotes";

export const ORDER_TYPES = {
  Order: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "feeAmount", type: "uint256" },
    { name: "feeTo", type: "address" },
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
  token: Address;
  amount: bigint;
  feeAmount: bigint;
  feeTo: Address;
  deadline: bigint;
  nonce: bigint;
};

export function gasRescueDomain(verifyingContract: Address, chainId: number) {
  return {
    name: "GasRescue",
    version: "1",
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

export function buildOrder(params: {
  user: Address;
  token: Address;
  quote: RescueQuote;
  deadline: bigint;
  nonce: bigint;
}): RescueOrder {
  return {
    user: params.user,
    token: params.quote.token ?? params.token,
    amount: params.quote.amount,
    feeAmount: params.quote.feeAmount,
    feeTo: params.quote.feeTo,
    deadline: params.deadline,
    nonce: params.nonce,
  };
}

export function splitPermitSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const parsed = parseSignature(signature);
  const v = parsed.v ?? (parsed.yParity === 0 ? 27 : 28);
  return { v: Number(v), r: parsed.r, s: parsed.s };
}
