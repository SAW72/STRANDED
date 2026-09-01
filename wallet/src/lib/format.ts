import { formatUnits, parseUnits, type Address } from "viem";

export function formatTokenAmount(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
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
