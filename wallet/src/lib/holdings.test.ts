import { describe, expect, it, vi } from "vitest";
import { readLiveHoldings, readLivePermitAuth } from "./holdings";

const TOKEN = "0x5649fF51123D534044aA7E6cBc8762698Ffed713" as const;
const OWNER = "0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37" as const;

describe("readLiveHoldings", () => {
  it("reads token and native from the client, not from prior values", async () => {
    const readContract = vi.fn(async () => 1_000_000n * 10n ** 18n);
    const getBalance = vi.fn(async () => 3n * 10n ** 16n);
    const live = await readLiveHoldings({ readContract, getBalance }, TOKEN, OWNER);
    expect(live.tokenBalance).toBe(1_000_000n * 10n ** 18n);
    expect(live.nativeBalance).toBe(3n * 10n ** 16n);
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(getBalance).toHaveBeenCalledTimes(1);
    expect(getBalance).toHaveBeenCalledWith({ address: OWNER });
  });

  it("reads live token name and permit nonce (not MockERC20Permit / 0n)", async () => {
    const readContract = vi.fn(async (args: { functionName: string }) =>
      args.functionName === "name" ? "GasRescue Test Token" : 8n,
    );
    const live = await readLivePermitAuth({ readContract }, TOKEN, OWNER);
    expect(live.tokenName).toBe("GasRescue Test Token");
    expect(live.permitNonce).toBe(8n);
    expect(readContract).toHaveBeenCalledTimes(2);
  });
});
