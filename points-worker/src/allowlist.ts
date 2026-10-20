/**
 * GasRescueSwap addresses copied from wallet/src/lib/fixture.ts
 * (BASE_SEPOLIA_DEPLOY.gasRescue and ARB_SEPOLIA_DEPLOY.gasRescue).
 * The same addresses are the live contracts named in wallet/README.md.
 */
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const ARB_SEPOLIA_CHAIN_ID = 421614;

export const GAS_RESCUE_SWAP: Record<number, string> = {
  [BASE_SEPOLIA_CHAIN_ID]: "0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688",
  [ARB_SEPOLIA_CHAIN_ID]: "0x65e712222745A8FCCbF038A90Fa75caB0867993D",
};

export function allowlistedSwap(chainId: number): string | null {
  return GAS_RESCUE_SWAP[chainId] ?? null;
}
