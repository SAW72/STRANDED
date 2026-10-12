import { getAddress, isAddress } from "viem";
import { pointsApiUrl } from "../config";
import { ARB_SEPOLIA_CHAIN_ID } from "./chains";

/**
 * Read-only client for the planned points API:
 *   GET /points/:wallet
 *   GET /points/leaderboard
 * No write methods. No auth.
 */
export interface PointsClient {
  /** "example" when no base URL is set; "http" when VITE_POINTS_API_URL is set. */
  readonly source: "example" | "http";
  getWallet(wallet: string): Promise<WalletPoints>;
  getLeaderboard(): Promise<PointsLeaderboard>;
}

export type PointsCategory = {
  action: string;
  points: number;
  count: number;
};

export type PointsEntry = {
  action: string;
  points: number;
  txHash: string | null;
  chainId: number | null;
};

export type WalletPoints = {
  wallet: string;
  total: number;
  rank: number | null;
  categories: PointsCategory[];
  entries: PointsEntry[];
};

export type LeaderboardRow = {
  rank: number;
  wallet: string;
  total: number;
};

export type PointsLeaderboard = {
  rows: LeaderboardRow[];
};

export type PointsFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * EXAMPLE DATA — not a live ledger.
 * Shown only when VITE_POINTS_API_URL is unset. Scores follow the flat rubric
 * (rescue is 100). These rows are a fixture for the page, not recorded activity.
 */
export const EXAMPLE_POINTS_ADDRESS = "0x1111111111111111111111111111111111111111";

/** Second example address, ranked above EXAMPLE_POINTS_ADDRESS. Also example data. */
export const EXAMPLE_POINTS_HIGHER_ADDRESS = "0x2222222222222222222222222222222222222222";

const EXAMPLE_RESCUE_TX = `0x${"ab".repeat(32)}`;
const EXAMPLE_FIND_TX = `0x${"cd".repeat(32)}`;
const EXAMPLE_JOB_TX = `0x${"ef".repeat(32)}`;

const EXAMPLE_WALLETS: Record<string, WalletPoints> = {
  [EXAMPLE_POINTS_ADDRESS]: {
    wallet: EXAMPLE_POINTS_ADDRESS,
    total: 140,
    rank: 2,
    categories: [
      { action: "rescue", points: 100, count: 1 },
      { action: "registry_find", points: 30, count: 1 },
      { action: "session", points: 10, count: 1 },
    ],
    entries: [
      {
        action: "rescue",
        points: 100,
        txHash: EXAMPLE_RESCUE_TX,
        chainId: ARB_SEPOLIA_CHAIN_ID,
      },
      {
        action: "registry_find",
        points: 30,
        txHash: EXAMPLE_FIND_TX,
        chainId: ARB_SEPOLIA_CHAIN_ID,
      },
      { action: "session", points: 10, txHash: null, chainId: null },
    ],
  },
  [EXAMPLE_POINTS_HIGHER_ADDRESS]: {
    wallet: EXAMPLE_POINTS_HIGHER_ADDRESS,
    total: 200,
    rank: 1,
    categories: [
      { action: "rescue", points: 100, count: 1 },
      { action: "relayer_job", points: 50, count: 1 },
      { action: "registry_claim", points: 50, count: 1 },
    ],
    entries: [
      {
        action: "rescue",
        points: 100,
        txHash: EXAMPLE_RESCUE_TX,
        chainId: ARB_SEPOLIA_CHAIN_ID,
      },
      {
        action: "relayer_job",
        points: 50,
        txHash: EXAMPLE_JOB_TX,
        chainId: ARB_SEPOLIA_CHAIN_ID,
      },
      {
        action: "registry_claim",
        points: 50,
        txHash: EXAMPLE_FIND_TX,
        chainId: ARB_SEPOLIA_CHAIN_ID,
      },
    ],
  },
};

const EXAMPLE_LEADERBOARD: PointsLeaderboard = {
  rows: [
    { rank: 1, wallet: EXAMPLE_POINTS_HIGHER_ADDRESS, total: 200 },
    { rank: 2, wallet: EXAMPLE_POINTS_ADDRESS, total: 140 },
  ],
};

export function normaliseWalletAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isAddress(trimmed)) return null;
  try {
    return getAddress(trimmed).toLowerCase();
  } catch {
    return null;
  }
}

export function emptyWalletPoints(wallet: string): WalletPoints {
  return { wallet, total: 0, rank: null, categories: [], entries: [] };
}

export function pointsWalletPath(wallet: string): string {
  return `/points/${encodeURIComponent(wallet)}`;
}

export function pointsLeaderboardPath(): string {
  return "/points/leaderboard";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidBody(): Error {
  return new Error("points_invalid_body");
}

function readPoints(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalidBody();
  return value;
}

function readAction(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9_]{1,40}$/.test(value)) throw invalidBody();
  return value;
}

function readTxHash(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw invalidBody();
  return value;
}

function readChainId(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw invalidBody();
  return value;
}

function readRank(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw invalidBody();
  return value;
}

function readWallet(value: unknown, expected: string): string {
  if (typeof value !== "string") throw invalidBody();
  const normalised = normaliseWalletAddress(value);
  if (!normalised || normalised !== expected) throw invalidBody();
  return normalised;
}

export function parseWalletPoints(value: unknown, expectedWallet: string): WalletPoints {
  if (!isRecord(value)) throw invalidBody();
  if (!Array.isArray(value.categories) || !Array.isArray(value.entries)) throw invalidBody();
  return {
    wallet: readWallet(value.wallet, expectedWallet),
    total: readPoints(value.total),
    rank: readRank(value.rank),
    categories: value.categories.map((item) => {
      if (!isRecord(item)) throw invalidBody();
      return {
        action: readAction(item.action),
        points: readPoints(item.points),
        count: readPoints(item.count),
      };
    }),
    entries: value.entries.map((item) => {
      if (!isRecord(item)) throw invalidBody();
      return {
        action: readAction(item.action),
        points: readPoints(item.points),
        txHash: readTxHash(item.txHash),
        chainId: readChainId(item.chainId),
      };
    }),
  };
}

export function parseLeaderboard(value: unknown): PointsLeaderboard {
  if (!isRecord(value) || !Array.isArray(value.rows)) throw invalidBody();
  return {
    rows: value.rows.map((item) => {
      if (!isRecord(item)) throw invalidBody();
      const wallet = normaliseWalletAddress(typeof item.wallet === "string" ? item.wallet : "");
      if (!wallet) throw invalidBody();
      const rank = readRank(item.rank);
      if (rank == null) throw invalidBody();
      return { rank, wallet, total: readPoints(item.total) };
    }),
  };
}

function requireWallet(wallet: string): string {
  const normalised = normaliseWalletAddress(wallet);
  if (!normalised) throw new Error("points_invalid_address");
  return normalised;
}

export function createExamplePointsClient(): PointsClient {
  return {
    source: "example",
    async getWallet(wallet: string) {
      const normalised = requireWallet(wallet);
      const row = EXAMPLE_WALLETS[normalised];
      if (!row) return emptyWalletPoints(normalised);
      return parseWalletPoints(row, normalised);
    },
    async getLeaderboard() {
      return parseLeaderboard(EXAMPLE_LEADERBOARD);
    },
  };
}

export function createHttpPointsClient(baseUrl: string, fetchImpl: PointsFetch = fetch): PointsClient {
  const root = baseUrl.trim().replace(/\/$/, "");
  async function getJson(path: string): Promise<{ status: number; body: unknown }> {
    const response = await fetchImpl(`${root}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { status: 404, body: null };
    if (!response.ok) throw new Error(`points_http_${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidBody();
    }
    return { status: response.status, body };
  }

  return {
    source: "http",
    async getWallet(wallet: string) {
      const normalised = requireWallet(wallet);
      const { status, body } = await getJson(pointsWalletPath(normalised));
      if (status === 404) return emptyWalletPoints(normalised);
      return parseWalletPoints(body, normalised);
    },
    async getLeaderboard() {
      const { body } = await getJson(pointsLeaderboardPath());
      return parseLeaderboard(body);
    },
  };
}

/** Example client when the base URL is unset. Pass a URL to call the HTTP API. */
export function createPointsClient(baseUrl: string = pointsApiUrl()): PointsClient {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) return createExamplePointsClient();
  return createHttpPointsClient(trimmed);
}
