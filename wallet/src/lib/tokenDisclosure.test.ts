import { describe, expect, it } from "vitest";
import { bannedWordsIn } from "./bannedWords";
import { ARB_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "./chains";
import appSource from "../App.tsx?raw";
import pointsSource from "../Points.tsx?raw";
import copySource from "../copy.ts?raw";
import copyValueSource from "../CopyValue.tsx?raw";
import indexHtml from "../../index.html?raw";
import receiptSource from "../RescueReceipt.tsx?raw";
import celebrationSource from "../StrandedCelebration.tsx?raw";
import pickerSource from "../WalletPicker.tsx?raw";
import * as copy from "../copy";
import { QUOTE_ERROR } from "../copy";
import { quoteSessionAfterSignThrow } from "./quoteSession";
import { fetchRescueQuote } from "./quotes";
import { publicSubmitError } from "./rescues";
import {
  RESCUE_COULD_NOT_SEND,
  RESCUE_NOT_AVAILABLE,
  RESCUE_SEND_FAILED,
  RESCUE_UNREACHABLE,
  SIGNATURE_CANCELLED,
  SIGNATURE_FAILED,
} from "./relayerError";
import disclosureSource from "./tokenDisclosure.ts?raw";
import {
  demoBannerText,
  tokenDisclosure,
  UNKNOWN_DEMO_BANNER,
  UNKNOWN_TOKEN_DISCLOSURE,
} from "./tokenDisclosure";

const SDEMO_DISCLOSURE =
  "SDEMO is a testnet demo token on Arbitrum Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.";
const GRTT_DISCLOSURE =
  "GRTT is a testnet demo token on Arbitrum Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.";
const SDEMO_BANNER = "Testnet demo. SDEMO has no value and isn't for sale.";
const GRTT_BANNER = "Testnet demo. GRTT has no value and isn't for sale.";

/** User-visible sources. Code identifiers in other modules are not included. */
const COPY_SOURCES = [
  copySource,
  disclosureSource,
  appSource,
  pointsSource,
  celebrationSource,
  receiptSource,
  pickerSource,
  copyValueSource,
  indexHtml,
];

function stringLiterals(source: string): string[] {
  const found: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    found.push(raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'"));
  }
  return found;
}

/** Text nodes in JSX, separate from quoted source strings. */
function jsxText(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const found: string[] = [];
  for (const match of withoutComments.matchAll(/>([^<>{}]+)</g)) {
    const text = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (text) found.push(text);
  }
  return found;
}

/** Sentences and short labels. Skips class names, paths, and other non-copy literals. */
function isUserCopy(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes(" ")) return true;
  return /^[A-Za-z][A-Za-z'’?!]{0,40}$/.test(trimmed);
}

describe("token disclosure", () => {
  it("uses the loaded ticker, and a fixed sentence when the symbol is unknown", () => {
    expect(tokenDisclosure("SDEMO")).toBe(SDEMO_DISCLOSURE);
    expect(tokenDisclosure("  GRTT  ")).toBe(GRTT_DISCLOSURE);
    expect(tokenDisclosure(null)).toBe(UNKNOWN_TOKEN_DISCLOSURE);
    expect(tokenDisclosure(undefined)).toBe(UNKNOWN_TOKEN_DISCLOSURE);
    expect(tokenDisclosure("")).toBe(UNKNOWN_TOKEN_DISCLOSURE);
    expect(tokenDisclosure("   ")).toBe(UNKNOWN_TOKEN_DISCLOSURE);
    expect(tokenDisclosure("not a ticker")).toBe(UNKNOWN_TOKEN_DISCLOSURE);
  });

  it("builds the site banner from the same ticker", () => {
    expect(demoBannerText("SDEMO")).toBe(SDEMO_BANNER);
    expect(demoBannerText("GRTT")).toBe(GRTT_BANNER);
    expect(demoBannerText(null)).toBe(UNKNOWN_DEMO_BANNER);
    expect(demoBannerText("")).toBe(UNKNOWN_DEMO_BANNER);
    expect(UNKNOWN_DEMO_BANNER).toBe(SDEMO_BANNER);
    expect(UNKNOWN_DEMO_BANNER).not.toMatch(/this token/i);
  });

  it("names Base Sepolia when that chain is selected", () => {
    expect(tokenDisclosure("SDEMO", BASE_SEPOLIA_CHAIN_ID)).toBe(
      "SDEMO is a testnet demo token on Base Sepolia. It has no value and is not for sale. This is experimental, unaudited demo software.",
    );
    expect(tokenDisclosure(null, BASE_SEPOLIA_CHAIN_ID)).toContain("on Base Sepolia");
    expect(tokenDisclosure(null, BASE_SEPOLIA_CHAIN_ID)).not.toContain("Arbitrum");
    expect(tokenDisclosure("SDEMO", ARB_SEPOLIA_CHAIN_ID)).toBe(SDEMO_DISCLOSURE);
    expect(tokenDisclosure(null)).toBe(UNKNOWN_TOKEN_DISCLOSURE);
  });
});

describe("banned words in user-visible copy", () => {
  const scanned = [
    ...(Object.values(copy) as readonly unknown[]).filter(
      (value): value is string => typeof value === "string",
    ),
    tokenDisclosure("SDEMO"),
    tokenDisclosure("GRTT"),
    tokenDisclosure(null),
    demoBannerText("SDEMO"),
    demoBannerText("GRTT"),
    demoBannerText(null),
    ...COPY_SOURCES.flatMap((source) => stringLiterals(source).filter(isUserCopy)),
    ...COPY_SOURCES.flatMap((source) => jsxText(source).filter(isUserCopy)),
  ];

  it("allows the phrase no value and rejects the banned list", () => {
    expect(bannedWordsIn("It has no value and is not for sale.")).toEqual([]);
    expect(bannedWordsIn("Testnet demo. This token has no value and isn't for sale.")).toEqual([]);
    expect(bannedWordsIn("invest in this airdrop for profit")).toEqual(
      expect.arrayContaining(["invest", "airdrop", "profit"]),
    );
    expect(bannedWordsIn("a live price")).toEqual(["price"]);
    expect(bannedWordsIn("high value")).toEqual(["value"]);
    expect(bannedWordsIn("They have no cash value, and nothing is promised.")).toEqual([]);
    expect(bannedWordsIn("high cash value")).toEqual(["value"]);
    expect(bannedWordsIn(["re", "wards"].join(""))).toEqual(["reward"]);
    expect(bannedWordsIn(["air", "drop", "ped"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["earn", "ed"].join(""))).toEqual(["earn"]);
  });

  it("finds none of the banned words in the disclosure, banner, copy module, or UI text", () => {
    const hits = scanned.flatMap((text) =>
      bannedWordsIn(text).map((word) => `${word}: ${text}`),
    );
    expect(hits).toEqual([]);
    const jsx = COPY_SOURCES.flatMap((source) => jsxText(source));
    expect(jsx.some((line) => line.includes("What happens to your tokens"))).toBe(true);
    for (const line of jsx) expect(line).not.toMatch(/\bearn/i);
  });

  it("error mappers never return Relayer POST, HTTP status, snake_case codes, viem@, or Details:", async () => {
    const developer = /Relayer POST|HTTP \d+|\b[a-z]+_[a-z0-9_]+\b|viem@|Details:/;
    const viem = new Error("User rejected the request.\n\nDetails: User rejected the request.\nVersion: viem@2.37.8");
    viem.name = "UserRejectedRequestError";
    const rejected = quoteSessionAfterSignThrow({ rescuePostAttempted: false, error: viem });
    const other = quoteSessionAfterSignThrow({
      rescuePostAttempted: false,
      error: new Error("Version: viem@2.37.8\nDetails: missing account"),
    });
    const thrown = quoteSessionAfterSignThrow({
      rescuePostAttempted: true,
      error: new Error("socket hang up"),
    });
    const unreachable = await fetchRescueQuote(
      "http://relayer.test",
      {
        user: "0x1111111111111111111111111111111111111111",
        tokenIn: "0x2222222222222222222222222222222222222222",
        amountIn: 1n,
        chainId: 84532,
      },
      async () => {
        throw new Error("offline");
      },
    );
    const httpQuote = await fetchRescueQuote(
      "http://relayer.test",
      {
        user: "0x1111111111111111111111111111111111111111",
        tokenIn: "0x2222222222222222222222222222222222222222",
        amountIn: 1n,
        chainId: 84532,
      },
      async () => new Response("nope", { status: 404 }),
    );

    const sentences = [
      RESCUE_UNREACHABLE,
      RESCUE_SEND_FAILED,
      RESCUE_NOT_AVAILABLE,
      RESCUE_COULD_NOT_SEND,
      SIGNATURE_CANCELLED,
      SIGNATURE_FAILED,
      QUOTE_ERROR,
      publicSubmitError(404, { ok: false, error: "not_found" }),
      publicSubmitError(502, { ok: false, error: "simulation_failed", revert: "Boom_code" }),
      publicSubmitError(500, { ok: false, error: "some_code" }),
      publicSubmitError(418, "not-json"),
      rejected.stage === "before-post" ? rejected.signError : "",
      other.stage === "before-post" ? other.signError : "",
      thrown.stage === "posting" && thrown.submitState.kind === "error" ? thrown.submitState.message : "",
      unreachable.ok ? "" : unreachable.reason,
      httpQuote.ok ? "" : httpQuote.reason,
    ];
    const hits = sentences.filter((text) => developer.test(text));
    expect(hits).toEqual([]);
  });
});
