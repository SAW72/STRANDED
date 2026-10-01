import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";
import copySource from "../copy.ts?raw";
import copyValueSource from "../CopyValue.tsx?raw";
import indexHtml from "../../index.html?raw";
import receiptSource from "../RescueReceipt.tsx?raw";
import celebrationSource from "../StrandedCelebration.tsx?raw";
import pickerSource from "../WalletPicker.tsx?raw";
import * as copy from "../copy";
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

const BANNED = [
  "invest",
  "earn",
  "reward",
  "airdrop",
  "presale",
  "price",
  "listing",
  "apy",
  "profit",
  "trade",
  "value",
] as const;

/** User-visible sources. Code identifiers in other modules are not included. */
const COPY_SOURCES = [
  copySource,
  disclosureSource,
  appSource,
  celebrationSource,
  receiptSource,
  pickerSource,
  copyValueSource,
  indexHtml,
];

function bannedWordsIn(text: string): string[] {
  const stripped = text.replace(/\bno value\b/gi, " ");
  return BANNED.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(stripped));
}

function stringLiterals(source: string): string[] {
  const found: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    found.push(raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'"));
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
  ];

  it("allows the phrase no value and rejects the banned list", () => {
    expect(bannedWordsIn("It has no value and is not for sale.")).toEqual([]);
    expect(bannedWordsIn("Testnet demo. This token has no value and isn't for sale.")).toEqual([]);
    expect(bannedWordsIn("invest in this airdrop for profit")).toEqual(
      expect.arrayContaining(["invest", "airdrop", "profit"]),
    );
    expect(bannedWordsIn("a live price")).toEqual(["price"]);
    expect(bannedWordsIn("high value")).toEqual(["value"]);
  });

  it("finds none of the banned words in the disclosure, banner, copy module, or UI text", () => {
    const hits = scanned.flatMap((text) =>
      bannedWordsIn(text).map((word) => `${word}: ${text}`),
    );
    expect(hits).toEqual([]);
  });
});
