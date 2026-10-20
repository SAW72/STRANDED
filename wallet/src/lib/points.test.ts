import { afterEach, describe, expect, it, vi } from "vitest";
import { ARB_SEPOLIA_CHAIN_ID } from "./chains";
import {
  EXAMPLE_POINTS_ADDRESS,
  EXAMPLE_POINTS_HIGHER_ADDRESS,
  createExamplePointsClient,
  createHttpPointsClient,
  createPointsClient,
  normaliseWalletAddress,
  type PointsFetch,
} from "./points";

describe("normaliseWalletAddress", () => {
  it("lowercases a valid address and rejects anything else", () => {
    const checksummed = "0x52908400098527886E0F7030069857D2E4169EE7";
    expect(normaliseWalletAddress("  " + checksummed + "  ")).toBe(checksummed.toLowerCase());
    expect(normaliseWalletAddress(EXAMPLE_POINTS_ADDRESS.toUpperCase().replace("0X", "0x"))).toBe(
      EXAMPLE_POINTS_ADDRESS,
    );
    expect(normaliseWalletAddress("")).toBeNull();
    expect(normaliseWalletAddress("0x1234")).toBeNull();
    expect(normaliseWalletAddress("not-an-address")).toBeNull();
    expect(normaliseWalletAddress("vitalik.eth")).toBeNull();
  });
});

describe("example points client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the labelled example ledger and does not call fetch", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createExamplePointsClient();
    expect(client.source).toBe("example");
    const wallet = await client.getWallet(EXAMPLE_POINTS_ADDRESS);
    expect(wallet.total).toBe(140);
    expect(wallet).not.toHaveProperty("rank");
    expect(wallet.categories.map((category) => category.action)).toEqual([
      "rescue",
      "registry_find",
      "session",
    ]);
    expect(wallet.entries[0]?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(wallet.entries[0]?.chainId).toBe(ARB_SEPOLIA_CHAIN_ID);
    expect(wallet.entries[2]?.txHash).toBeNull();

    const higher = await client.getWallet(EXAMPLE_POINTS_HIGHER_ADDRESS.toUpperCase().replace("0X", "0x"));
    expect(higher.wallet).toBe(EXAMPLE_POINTS_HIGHER_ADDRESS);
    expect(higher.total).toBe(200);
    expect(higher).not.toHaveProperty("rank");

    const empty = await client.getWallet("0x3333333333333333333333333333333333333333");
    expect(empty).toEqual({
      wallet: "0x3333333333333333333333333333333333333333",
      total: 0,
      categories: [],
      entries: [],
    });
    expect(empty).not.toHaveProperty("rank");

    const board = await client.getLeaderboard();
    expect(board.rows.map((row) => [row.wallet, row.total])).toEqual([
      [EXAMPLE_POINTS_HIGHER_ADDRESS, 200],
      [EXAMPLE_POINTS_ADDRESS, 140],
    ]);
    expect(board.rows.every((row) => !Object.hasOwn(row, "rank"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("http points client", () => {
  it("GETs /points/:wallet and /points/leaderboard and drops unknown fields", async () => {
    const calls: string[] = [];
    const fetchImpl: PointsFetch = async (input) => {
      calls.push(input);
      if (input.endsWith("/points/leaderboard")) {
        return new Response(
          JSON.stringify({
            rows: [{ rank: 1, wallet: EXAMPLE_POINTS_ADDRESS, total: 140, note: "ignore" }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          wallet: EXAMPLE_POINTS_ADDRESS,
          total: 100,
          rank: 4,
          usd: "$5",
          categories: [{ action: "rescue", points: 100, count: 1, label: "token value" }],
          entries: [
            {
              action: "rescue",
              points: 100,
              txHash: `0x${"ab".repeat(32)}`,
              chainId: ARB_SEPOLIA_CHAIN_ID,
            },
          ],
        }),
        { status: 200 },
      );
    };

    const client = createHttpPointsClient("https://points.example/", fetchImpl);
    expect(client.source).toBe("http");
    const wallet = await client.getWallet(EXAMPLE_POINTS_ADDRESS);
    const board = await client.getLeaderboard();
    expect(calls).toEqual([
      `https://points.example/points/${EXAMPLE_POINTS_ADDRESS}`,
      "https://points.example/points/leaderboard",
    ]);
    expect(wallet).toEqual({
      wallet: EXAMPLE_POINTS_ADDRESS,
      total: 100,
      categories: [{ action: "rescue", points: 100, count: 1 }],
      entries: [
        {
          action: "rescue",
          points: 100,
          txHash: `0x${"ab".repeat(32)}`,
          chainId: ARB_SEPOLIA_CHAIN_ID,
        },
      ],
    });
    expect(wallet).not.toHaveProperty("rank");
    expect(JSON.stringify(wallet).toLowerCase()).not.toContain("token value");
    expect(JSON.stringify(wallet)).not.toContain("$");
    expect(board.rows).toEqual([{ wallet: EXAMPLE_POINTS_ADDRESS, total: 140, rescues: 0 }]);
    expect(board.rows[0]).not.toHaveProperty("rank");
  });

  it("reads a wallet body that has no rank field", async () => {
    const fetchImpl: PointsFetch = async (input) => {
      if (input.endsWith("/points/leaderboard")) {
        return new Response(
          JSON.stringify({
            rows: [
              { wallet: EXAMPLE_POINTS_HIGHER_ADDRESS, total: 200, rescues: 5 },
              { wallet: EXAMPLE_POINTS_ADDRESS, total: 140 },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          wallet: EXAMPLE_POINTS_ADDRESS,
          total: 100,
          categories: [{ action: "rescue", points: 100, count: 1 }],
          entries: [
            {
              action: "rescue",
              points: 100,
              txHash: `0x${"ab".repeat(32)}`,
              chainId: ARB_SEPOLIA_CHAIN_ID,
            },
          ],
        }),
        { status: 200 },
      );
    };
    const client = createHttpPointsClient("https://points.example", fetchImpl);
    const wallet = await client.getWallet(EXAMPLE_POINTS_ADDRESS);
    const board = await client.getLeaderboard();
    expect(wallet.categories[0]?.action).toBe("rescue");
    expect(wallet.entries[0]?.points).toBe(100);
    expect(wallet).not.toHaveProperty("rank");
    expect(board.rows).toEqual([
      { wallet: EXAMPLE_POINTS_HIGHER_ADDRESS, total: 200, rescues: 5 },
      { wallet: EXAMPLE_POINTS_ADDRESS, total: 140, rescues: 0 },
    ]);
    expect(JSON.stringify(board)).not.toContain('"rank"');
  });

  it("treats 404 as an empty wallet and rejects a non-ok response", async () => {
    const missing: PointsFetch = async () => new Response("missing", { status: 404 });
    const empty = await createHttpPointsClient("https://points.example", missing).getWallet(
      EXAMPLE_POINTS_ADDRESS,
    );
    expect(empty.total).toBe(0);
    expect(empty.entries).toEqual([]);

    const down: PointsFetch = async () => new Response("no", { status: 500 });
    await expect(
      createHttpPointsClient("https://points.example", down).getWallet(EXAMPLE_POINTS_ADDRESS),
    ).rejects.toThrow(/points_http_500/);

    const priced: PointsFetch = async () =>
      new Response(JSON.stringify({ wallet: EXAMPLE_POINTS_ADDRESS, total: "$100" }), { status: 200 });
    await expect(
      createHttpPointsClient("https://points.example", priced).getWallet(EXAMPLE_POINTS_ADDRESS),
    ).rejects.toThrow(/points_invalid_body/);
  });

  it("does not use global fetch when a fetch implementation is injected", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchImpl: PointsFetch = async () => new Response("missing", { status: 404 });
    await createHttpPointsClient("https://points.example", fetchImpl).getWallet(EXAMPLE_POINTS_ADDRESS);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("createPointsClient", () => {
  it("stays on the example client when the base URL is blank", () => {
    expect(createPointsClient().source).toBe("example");
    expect(createPointsClient("").source).toBe("example");
    expect(createPointsClient("   ").source).toBe("example");
    expect(createPointsClient("https://points.example").source).toBe("http");
  });
});
