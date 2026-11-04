import { describe, expect, it } from "vitest";
import page from "../staging/tester-early-access.html?raw";
import sitemap from "../staging/sitemap.xml?raw";
import signup from "../../.github/ISSUE_TEMPLATE/tester-signup.yml?raw";
import readme from "../../README.md?raw";
import indexHtml from "../index.html?raw";
import appSource from "./App.tsx?raw";
import mainSource from "./main.tsx?raw";
import spaFallbackSource from "../spaFallback.ts?raw";
import viteConfigSource from "../vite.config.ts?raw";
import redirectsSource from "../public/_redirects?raw";
import renderSource from "../../render.yaml?raw";

const BASE_LINE = "Test now. An airdrop may come later; amount TBD.";
const PRIVACY = "We only use this to contact you about testing. Never share private keys or seed phrases.";
const ELIGIBILITY =
  "Eligibility is subject to terms, jurisdiction restrictions, and sanctions screening.";
const PUBLIC_NOTE = "GitHub issues are public. Your email and wallet address will be visible to anyone.";
const SIGNUP = "https://github.com/SAW72/STRANDED/issues/new?template=tester-signup.yml";
const MARKER = "PENDING LAWYER REVIEW";
const KEPT_FAUCETS = [
  "https://docs.base.org/get-started/get-funds",
  "https://www.alchemy.com/faucets/base-sepolia",
  "https://faucet.quicknode.com/base/sepolia",
  "https://www.alchemy.com/faucets/arbitrum-sepolia",
  "https://faucet.quicknode.com/arbitrum/sepolia",
];
const DROPPED_FAUCETS = [
  "https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet",
  "https://docs.base.org/chain/tools/network-faucets",
  "https://docs.arbitrum.io/for-devs/dev-tools-and-resources/faucets",
  "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
  "https://docs.arbitrum.io/arbitrum-essentials/reference/node-providers",
];

const leakedPublic = import.meta.glob(
  ["../public/sitemap.xml", "../public/tester-early-access.html"],
  { eager: true },
);

describe("unpublished tester page", () => {
  it("keeps the draft page and sitemap out of the published site", () => {
    expect(page).toContain(MARKER);
    expect(page).toContain(BASE_LINE);
    expect(page).toContain(PRIVACY);
    expect(page).toContain(ELIGIBILITY);
    expect(page).toContain(PUBLIC_NOTE);
    expect(page).toContain(SIGNUP);
    expect(page).toContain("<title>Stranded: swap a slice for gas on testnet</title>");
    expect(page).toContain('name="description"');
    expect(page).toContain('property="og:title"');
    expect(page).toContain('property="og:description"');
    expect(page).toContain('property="og:image"');
    expect(page).toContain('property="og:url"');
    expect(page).toContain('property="og:type"');
    expect(page).toContain('name="robots" content="noindex, nofollow"');
    expect(page).not.toContain("<script");
    expect(page).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(page).not.toContain("strandedtoken.trade/tester");
    expect(sitemap).toContain("wallet/staging/tester-early-access.html");
    expect(sitemap).not.toContain("strandedtoken.trade");
    expect(Object.keys(leakedPublic)).toEqual([]);
    for (const faucet of KEPT_FAUCETS) expect(page).toContain(faucet);
    for (const faucet of DROPPED_FAUCETS) expect(page).not.toContain(faucet);
    for (const text of [
      indexHtml,
      appSource,
      mainSource,
      spaFallbackSource,
      viteConfigSource,
      redirectsSource,
      renderSource,
    ]) {
      expect(text).not.toContain("tester-early-access");
      expect(text).not.toContain("tester-signup");
    }
    expect(renderSource).toContain("staticPublishPath: wallet/dist");
  });

  it("limits the sign-up form to email and an optional wallet", () => {
    expect(signup).toContain(MARKER);
    expect(signup).toContain(BASE_LINE);
    expect(signup).toContain(PRIVACY);
    expect(signup).toContain(ELIGIBILITY);
    expect(signup).toContain(PUBLIC_NOTE);
    expect(signup).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(signup).not.toMatch(/type: (textarea|dropdown|checkboxes)/);
    const ids = [...signup.matchAll(/^ {4}id: (\S+)/gm)].map((match) => match[1]);
    expect(ids).toEqual(["email", "wallet-address"]);
    expect(signup).toMatch(/id: email[\s\S]*required: true/);
    expect(signup).toMatch(/id: wallet-address[\s\S]*required: false/);
  });

  it("puts the draft notice in the README without a live-site link", () => {
    const start = readme.indexOf("## Tester / early access");
    const end = readme.indexOf("## Phase-2 scaffold");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = readme.slice(start, end);
    expect(section).toContain(MARKER);
    expect(section).toContain(BASE_LINE);
    expect(section).toContain(PRIVACY);
    expect(section).toContain(ELIGIBILITY);
    expect(section).toContain(PUBLIC_NOTE);
    expect(section).toContain(SIGNUP);
    expect(section).toContain("wallet/staging/tester-early-access.html");
    expect(section).toContain("wallet/staging/sitemap.xml");
    expect(section).not.toContain("strandedtoken.trade/tester");
    expect(section).not.toMatch(/0x[a-fA-F0-9]{40}/);
    for (const faucet of KEPT_FAUCETS) expect(section).toContain(faucet);
  });
});
