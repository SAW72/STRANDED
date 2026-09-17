import { isAddress, type Address, type Hex } from "viem";

/**
 * `GasRescueLens` read ABI — wallet / HackQuest consumers.
 * Lens is not live until Spencer broadcasts DeployGasRescueLens.
 * Permit2 is observed only; this ABI has no setter.
 */
export const gasRescueLensAbi = [
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "out",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "swap", type: "address" },
          { name: "owner", type: "address" },
          { name: "pendingOwner", type: "address" },
          { name: "paused", type: "bool" },
          { name: "weth", type: "address" },
          { name: "permit2", type: "address" },
          { name: "permit2Enabled", type: "bool" },
          { name: "permit2IsCanonicalOrZero", type: "bool" },
          { name: "boundToLiveArb", type: "bool" },
          { name: "boundToLiveBase", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "arbDemoReadiness",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "notPaused", type: "bool" },
          { name: "relayerOk", type: "bool" },
          { name: "tokenAllowed", type: "bool" },
          { name: "tokenEip2612", type: "bool" },
          { name: "routerAllowed", type: "bool" },
          { name: "nonceUnused", type: "bool" },
          { name: "userFunded", type: "bool" },
          { name: "permit2Off", type: "bool" },
          { name: "ready", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "rescueReceiptOrMissing",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [
      { name: "supported", type: "bool" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "relayer", type: "address" },
    ],
  },
  {
    type: "function",
    name: "hackQuestReport",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "amountIn", type: "uint256" },
      { name: "nativeTo", type: "address" },
      { name: "quotedPathHash", type: "bytes32" },
    ],
    outputs: [
      {
        name: "out",
        type: "tuple",
        components: [
          {
            name: "swapStatus",
            type: "tuple",
            components: [
              { name: "chainId", type: "uint256" },
              { name: "swap", type: "address" },
              { name: "owner", type: "address" },
              { name: "pendingOwner", type: "address" },
              { name: "paused", type: "bool" },
              { name: "weth", type: "address" },
              { name: "permit2", type: "address" },
              { name: "permit2Enabled", type: "bool" },
              { name: "permit2IsCanonicalOrZero", type: "bool" },
              { name: "boundToLiveArb", type: "bool" },
              { name: "boundToLiveBase", type: "bool" },
            ],
          },
          {
            name: "readiness",
            type: "tuple",
            components: [
              { name: "notPaused", type: "bool" },
              { name: "relayerOk", type: "bool" },
              { name: "tokenAllowed", type: "bool" },
              { name: "tokenEip2612", type: "bool" },
              { name: "routerAllowed", type: "bool" },
              { name: "nonceUnused", type: "bool" },
              { name: "userFunded", type: "bool" },
              { name: "permit2Off", type: "bool" },
              { name: "ready", type: "bool" },
            ],
          },
          {
            name: "bytecode",
            type: "tuple",
            components: [
              { name: "hasCanonicalPermit2Getter", type: "bool" },
              { name: "hasRescueReceipt", type: "bool" },
              { name: "setPermit2IsImmutable", type: "bool" },
              { name: "permit2Enabled", type: "bool" },
              { name: "permit2IsCanonicalOrZero", type: "bool" },
              { name: "tipMatchesLiveViews", type: "bool" },
            ],
          },
          {
            name: "receipt",
            type: "tuple",
            components: [
              { name: "supported", type: "bool" },
              { name: "tokenIn", type: "address" },
              { name: "amountIn", type: "uint256" },
              { name: "relayer", type: "address" },
            ],
          },
          {
            name: "paths",
            type: "tuple",
            components: [
              { name: "grttPathHash", type: "bytes32" },
              { name: "gmockPathHash", type: "bytes32" },
              { name: "quotedIsWalletDryPlaceholder", type: "bool" },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "demoPathHash",
    stateMutability: "pure",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "amountSwap", type: "uint256" },
      { name: "nativeTo", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

export type LensRescueReceiptView = {
  supported: boolean;
  tokenIn: Address;
  amountIn: bigint;
  relayer: Address;
};

/** Live 2026-09-14 Arb bytecode has no `rescueReceipt` — `supported` is false. */
export function parseRescueReceiptView(raw: {
  supported: boolean;
  tokenIn: Address;
  amountIn: bigint;
  relayer: Address;
}): LensRescueReceiptView {
  return {
    supported: raw.supported,
    tokenIn: raw.tokenIn,
    amountIn: raw.amountIn,
    relayer: raw.relayer,
  };
}

export function optionalLensAddress(raw: string | undefined | null): Address | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed && isAddress(trimmed) ? trimmed : null;
}

export function isHackQuestStatusJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return (
      parsed.product === "GasRescueSwap" &&
      (parsed.buildathon === "2026-09-17-day5" ||
        parsed.buildathon === "2026-09-17-day4" ||
        parsed.buildathon === "2026-09-14-day3" ||
        parsed.buildathon === "2026-09-14-day2") &&
      parsed.permit2Enabled === false &&
      typeof parsed.grttDemoPathHash === "string" &&
      typeof parsed.hasRescueReceipt === "boolean" &&
      typeof parsed.lensEphemeral === "boolean"
    );
  } catch {
    return false;
  }
}

/** Wallet never treats a missing Lens address as a live deploy. */
export function lensCallArgs(
  user: Address,
  nonce: bigint,
  amountIn: bigint,
  nativeTo: Address,
  quotedPathHash: Hex,
): readonly [Address, bigint, bigint, Address, Hex] {
  return [user, nonce, amountIn, nativeTo, quotedPathHash];
}
