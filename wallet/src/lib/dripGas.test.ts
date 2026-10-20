import { describe, expect, it } from "vitest";
import { arbDripFees, dripErrorText } from "./dripGas";

describe("arb drip fees", () => {
  it("bids at least 0.1 gwei when the base fee is near 0.02 gwei", () => {
    const fees = arbDripFees(20_204_000n);
    expect(fees.maxFeePerGas).toBe(100_000_000n);
    expect(fees.maxFeePerGas > 20_204_000n).toBe(true);
    expect(fees.maxPriorityFeePerGas).toBe(0n);
  });

  it("doubles a base fee that is already above the floor", () => {
    expect(arbDripFees(150_000_000n).maxFeePerGas).toBe(300_000_000n);
    expect(arbDripFees(null).maxFeePerGas).toBe(200_000_000n);
    expect(arbDripFees(0n).maxFeePerGas).toBe(200_000_000n);
  });

  it("turns the low gas bid into a short sentence", () => {
    const err = new Error(
      "max fee per gas less than block base fee: maxFeePerGas: 20054000 baseFee: 20204000",
    );
    expect(dripErrorText(err)).toBe("The gas bid was below the current block. Press Get 2 tDEMO again.");
    expect(dripErrorText(new Error("FaucetEmpty"))).toBe("The faucet is empty.");
    expect(dripErrorText(new Error("DripCooldown"))).toBe(
      "This wallet already took tDEMO in the last 24 hours.",
    );
  });
});
