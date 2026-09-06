import type { Address } from "viem";
import { erc20PermitAbi } from "../abi";

/** Minimal RPC surface so callers can pass a wagmi/viem public client. */
export type HoldingsRpc = {
  readContract: (args: {
    address: Address;
    abi: typeof erc20PermitAbi;
    functionName: "balanceOf";
    args: readonly [Address];
  }) => Promise<bigint>;
  getBalance: (args: { address: Address }) => Promise<bigint>;
};

export type LiveHoldings = {
  tokenBalance: bigint;
  nativeBalance: bigint;
};

/**
 * Live eth_call for token + native. Do not use a React Query / wagmi cache here —
 * cached GRTT caused "use full balance" and "start new rescue" to quote a spent amount.
 */
export async function readLiveHoldings(
  client: HoldingsRpc,
  token: Address,
  owner: Address,
): Promise<LiveHoldings> {
  const [tokenBalance, nativeBalance] = await Promise.all([
    client.readContract({
      address: token,
      abi: erc20PermitAbi,
      functionName: "balanceOf",
      args: [owner],
    }),
    client.getBalance({ address: owner }),
  ]);
  return { tokenBalance, nativeBalance };
}

export type PermitAuthRpc = {
  readContract: (args: {
    address: Address;
    abi: typeof erc20PermitAbi;
    functionName: "name" | "nonces";
    args?: readonly [Address];
  }) => Promise<string | bigint>;
};

export type LivePermitAuth = {
  tokenName: string;
  permitNonce: bigint;
};

/**
 * Live name() + nonces() for EIP-2612. Cached name ("MockERC20Permit") or a
 * spent permit nonce produces ERC2612InvalidSigner (0x4b800e46) at simulate.
 */
export async function readLivePermitAuth(
  client: PermitAuthRpc,
  token: Address,
  owner: Address,
): Promise<LivePermitAuth> {
  const [tokenName, permitNonce] = await Promise.all([
    client.readContract({
      address: token,
      abi: erc20PermitAbi,
      functionName: "name",
    }) as Promise<string>,
    client.readContract({
      address: token,
      abi: erc20PermitAbi,
      functionName: "nonces",
      args: [owner],
    }) as Promise<bigint>,
  ]);
  const name = typeof tokenName === "string" ? tokenName.trim() : "";
  if (!name) {
    throw new Error("Token name is missing on-chain; cannot sign permit.");
  }
  if (typeof permitNonce !== "bigint") {
    throw new Error("Permit nonce is missing on-chain; cannot sign permit.");
  }
  return { tokenName: name, permitNonce };
}
