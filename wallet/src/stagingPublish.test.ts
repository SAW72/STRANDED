import { describe, expect, it } from "vitest";
import page from "../staging/tester-early-access.html?raw";
import airdrop from "../staging/airdrop-interest.html?raw";
import sitemap from "../staging/sitemap.xml?raw";
import terms from "../staging/tester-terms.html?raw";
import privacy from "../staging/privacy-notice.html?raw";
import sanctions from "../staging/sanctions.html?raw";
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
const PRODUCTION = "Stranded runs on production smart contracts that use real funds.";
const POINTS =
  "Testing is optional and at your own risk. You may lose any funds you use, and we do not ask you to deposit funds. Testers can earn points for testing. Points have no cash or monetary value, are not transferable, cannot be sold or exchanged, and are not tokens, securities or a promise of any future token, airdrop or payment. Points are not earned by depositing funds or by the amount of funds used. We may change or end the points program at any time.";
const POINTS_BASIS = "Points are per task or per bug reported, never per amount or volume.";
const NO_PRIZES = "There are no leaderboards, ranks, or prizes.";
const NO_OFFER = "Nothing here is an offer of tokens, value or any investment.";
const RECOGNITION =
  "Testers may be considered for future recognition, subject to terms, eligibility and sanctions screening. Recognition does not depend on depositing or using funds, and nothing here is an offer of tokens or value.";
const RETIRED_EARN =
  /does not earn rewards|testing does not earn rewards or value|testnet activity does not earn tokens/;
const SANCTIONS_ATTESTATION =
  "I am not located in, ordinarily resident in, or organized in a jurisdiction subject to comprehensive U.S. sanctions, and I am not on, or owned or controlled by anyone on, a U.S. sanctions list, including OFAC's SDN List. I agree to the Tester Terms and Privacy Notice:";
const FORM_DESCRIPTION = "Volunteer to test. No payment, token or value is promised.";
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
  [
    "../public/sitemap.xml",
    "../public/tester-early-access.html",
    "../public/tester-terms.html",
    "../public/privacy-notice.html",
    "../public/sanctions.html",
    "../public/airdrop-interest.html",
  ],
  { eager: true },
);

describe("unpublished tester page", () => {
  it("keeps the draft page and sitemap out of the published site", () => {
    expect(page).toContain(MARKER);
    expect(page).not.toContain(BASE_LINE);
    expect(page).toContain(PRIVACY);
    expect(page).toContain(ELIGIBILITY);
    expect(page).toContain(PUBLIC_NOTE);
    expect(page).toContain(SIGNUP);
    expect(page).toContain(PRODUCTION);
    expect(page).toContain(POINTS);
    expect(page).toContain(POINTS_BASIS);
    expect(page).toContain(NO_PRIZES);
    expect(page).toContain(NO_OFFER);
    expect(page).toContain(RECOGNITION);
    expect(page).not.toMatch(RETIRED_EARN);
    expect(page).not.toContain("strandedtoken.trade");
    expect(page).toContain('href="tester-terms.html"');
    expect(page).toContain('href="privacy-notice.html"');
    expect(page).toContain('href="sanctions.html"');
    expect(page).not.toContain("use small amounts");
    expect(page).not.toContain("No guaranteed value");
    for (const draft of [terms, privacy, sanctions]) {
      expect(draft).toContain(MARKER);
      expect(draft).toContain("DRAFT");
      expect(draft).toContain('name="robots" content="noindex, nofollow"');
    }
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
    expect(airdrop).toContain(MARKER);
    expect(airdrop).toContain(BASE_LINE);
    expect(airdrop).toContain(ELIGIBILITY);
    expect(airdrop).toContain(NO_OFFER);
    expect(airdrop).toContain("An airdrop is not promised.");
    expect(airdrop).toContain("<title>Stranded airdrop interest (draft)</title>");
    expect(airdrop).toContain('name="description"');
    expect(airdrop).toContain('property="og:title"');
    expect(airdrop).toContain('property="og:description"');
    expect(airdrop).toContain('property="og:image"');
    expect(airdrop).toContain('property="og:url"');
    expect(airdrop).toContain('property="og:type"');
    expect(airdrop).toContain('name="robots" content="noindex, nofollow"');
    expect(airdrop).toContain("DRAFT");
    expect(airdrop).not.toContain("<script");
    expect(airdrop.toLowerCase()).not.toContain("points");
    expect(airdrop).not.toContain("strandedtoken.trade");
    expect(airdrop).not.toMatch(RETIRED_EARN);
    expect(sitemap).toContain("wallet/staging/tester-early-access.html");
    expect(sitemap).toContain("wallet/staging/airdrop-interest.html");
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
      expect(text).not.toContain("tester-terms");
      expect(text).not.toContain("privacy-notice");
      expect(text).not.toContain("sanctions.html");
      expect(text).not.toContain("airdrop-interest");
    }
    expect(renderSource).toContain("staticPublishPath: wallet/dist");
  });

  it("limits the sign-up form to email and an optional wallet", () => {
    expect(signup).toContain(MARKER);
    expect(signup).not.toContain(BASE_LINE);
    expect(signup).toContain(PRIVACY);
    expect(signup).toContain(ELIGIBILITY);
    expect(signup).toContain(PUBLIC_NOTE);
    expect(signup).toContain(PRODUCTION);
    expect(signup).toContain(POINTS);
    expect(signup).toContain(POINTS_BASIS);
    expect(signup).toContain(NO_PRIZES);
    expect(signup).toContain(NO_OFFER);
    expect(signup).toContain(RECOGNITION);
    expect(signup).not.toMatch(RETIRED_EARN);
    expect(signup).not.toContain("strandedtoken.trade");
    expect(signup).toContain(SANCTIONS_ATTESTATION);
    expect(signup).toContain(FORM_DESCRIPTION);
    expect(signup).toContain("wallet/staging/tester-terms.html");
    expect(signup).toContain("wallet/staging/privacy-notice.html");
    expect(signup).toContain("wallet/staging/sanctions.html");
    expect(signup).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(signup).not.toMatch(/type: (textarea|dropdown)\b/);
    expect(signup.match(/type: checkboxes/g)).toEqual(["type: checkboxes"]);
    const ids = [...signup.matchAll(/^ {4}id: (\S+)/gm)].map((match) => match[1]);
    expect(ids).toEqual(["email", "wallet-address", "sanctions-and-terms"]);
    expect(signup).toMatch(/id: email[\s\S]*required: true/);
    expect(signup).toMatch(/id: wallet-address[\s\S]*required: false/);
    expect(signup).toMatch(/id: sanctions-and-terms[\s\S]*required: true/);
  });

  it("puts the draft notice in the README without a live-site link", () => {
    const start = readme.indexOf("## Tester / early access");
    const airdropStart = readme.indexOf("## Airdrop interest");
    const end = readme.indexOf("## Phase-2 scaffold");
    expect(start).toBeGreaterThan(0);
    expect(airdropStart).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(airdropStart);
    const section = readme.slice(start, airdropStart);
    const airdropSection = readme.slice(airdropStart, end);
    expect(section).toContain(MARKER);
    expect(section).not.toContain(BASE_LINE);
    expect(section).toContain(PRIVACY);
    expect(section).toContain(ELIGIBILITY);
    expect(section).toContain(PUBLIC_NOTE);
    expect(section).toContain(SIGNUP);
    expect(section).toContain(PRODUCTION);
    expect(section).toContain(POINTS);
    expect(section).toContain(POINTS_BASIS);
    expect(section).toContain(NO_PRIZES);
    expect(section).toContain(NO_OFFER);
    expect(section).toContain(RECOGNITION);
    expect(section).not.toMatch(RETIRED_EARN);
    expect(section).not.toContain("strandedtoken.trade");
    expect(airdropSection).toContain(MARKER);
    expect(airdropSection).toContain(BASE_LINE);
    expect(airdropSection).toContain("An airdrop is not promised.");
    expect(airdropSection).toContain("wallet/staging/airdrop-interest.html");
    expect(airdropSection.toLowerCase()).not.toContain("points");
    expect(airdropSection).not.toContain("strandedtoken.trade");
    expect(section).toContain("wallet/staging/tester-terms.html");
    expect(section).toContain("wallet/staging/privacy-notice.html");
    expect(section).toContain("wallet/staging/sanctions.html");
    expect(section).toContain("wallet/staging/tester-early-access.html");
    expect(section).toContain("wallet/staging/sitemap.xml");
    expect(section).not.toContain("strandedtoken.trade/tester");
    expect(section).not.toMatch(/0x[a-fA-F0-9]{40}/);
    for (const faucet of KEPT_FAUCETS) expect(section).toContain(faucet);
  });
});
