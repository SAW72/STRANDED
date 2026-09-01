import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { chainLabel, nativeSymbol } from "./chains";

export function formatTokenAmount(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

export function formatTokenAmountWithSymbol(
  value: bigint,
  decimals: number,
  symbol?: string,
): string {
  const amount = formatTokenAmount(value, decimals);
  return symbol ? `${amount} ${symbol}` : amount;
}

export function formatNativeOut(value: bigint, chainId?: number): string {
  return `${formatUnits(value, 18)} ${nativeSymbol(chainId)}`;
}

export function parseHumanAmount(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

export function shortenAddress(address: Address | string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortenBytes32(value: Hex | string): string {
  if (value.length < 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function formatDeadline(unixSeconds: bigint): string {
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return unixSeconds.toString();
  try {
    return `${new Date(ms).toISOString().replace(".000Z", "Z")} (${unixSeconds.toString()})`;
  } catch {
    return unixSeconds.toString();
  }
}

export function formatNetwork(chainId: number): string {
  return `${chainLabel(chainId)} (${chainId})`;
}
