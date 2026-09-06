import { hasRequiredQuoteFields, type RescueQuote } from "./quotes";

export type RescuePhase = "needs_quote" | "review" | "confirmed" | "signing" | "signed";

export type GateInput = {
  quote: RescueQuote | null;
  detailsConfirmed: boolean;
  signing: boolean;
  signed: boolean;
};

/**
 * Process gate: signatures are prompted only after the user confirms a
 * complete swap-for-gas quote. A missing quote never unlocks sign.
 */
export function rescuePhase(input: GateInput): RescuePhase {
  if (!hasRequiredQuoteFields(input.quote)) return "needs_quote";
  if (input.signed) return "signed";
  if (input.signing) return "signing";
  if (input.detailsConfirmed) return "confirmed";
  return "review";
}

export function canPromptSignatures(phase: RescuePhase): boolean {
  return phase === "confirmed" || phase === "signing" || phase === "signed";
}

export function confirmDetailsEnabled(phase: RescuePhase): boolean {
  return phase === "review";
}
