import { describe, expect, it } from "vitest";
import page from "../staging/tester-early-access.html?raw";
import airdrop from "../staging/airdrop-interest.html?raw";
import airdropTerms from "../staging/airdrop-terms.html?raw";
import sitemap from "../staging/sitemap.xml?raw";
import terms from "../staging/tester-terms.html?raw";
import privacy from "../staging/privacy-notice.html?raw";
import sanctions from "../staging/sanctions.html?raw";
import signup from "../../.github/ISSUE_TEMPLATE/tester-signup.yml?raw";
import readme from "../../README.md?raw";
import security from "../../SECURITY.md?raw";
import indexHtml from "../index.html?raw";
import appSource from "./App.tsx?raw";
import mainSource from "./main.tsx?raw";
import spaFallbackSource from "../spaFallback.ts?raw";
import viteConfigSource from "../vite.config.ts?raw";
import redirectsSource from "../public/_redirects?raw";
import renderSource from "../../render.yaml?raw";

const ABSENT = [
  ["amount", "TBD"].join(" "),
  ["future", "recognition"].join(" "),
  ["could include a", "token distribution"].join(" "),
];
const PRIVACY = "We only use this to contact you about testing. Never share private keys or seed phrases.";
const ELIGIBILITY =
  "Eligibility is subject to terms, jurisdiction restrictions, and sanctions screening.";
const PUBLIC_NOTE =
  "Do not post your email, wallet address or any key here. GitHub issues are public. We will reply in this issue with a link to a private form for contact details. Official contact: [TBD by Spencer].";
const HANDLE_ONLY =
  "This sign-up collects only your GitHub handle, which is the account that opens this issue.";
const SIGNUP = "https://github.com/SAW72/STRANDED/issues/new?template=tester-signup.yml";
const MARKER = "PENDING LAWYER REVIEW";
const TESTNET_ONLY =
  "Stranded runs on testnet only (Base Sepolia 84532 and Arb Sepolia 421614). Test tokens have no monetary value.";
const RETIRED_WALLET_LINE = "Use a wallet that holds no real funds.";
const RETIRED_PRODUCTION = "Stranded runs on production smart contracts that use real funds.";
const CHANGES =
  "We may change, suspend or cancel this program, the points program or these terms at any time without notice or liability.";
const RETENTION =
  "We keep tester data only as long as the program needs it, plus what law requires, then delete it [specific period TBD—attorney].";
const SANCTIONS_PARTICIPATE = "participate in, sign up for, or receive anything from";
const SANCTIONS_DISCRETION =
  "We may screen wallet addresses and participants, block access by geography, and withhold or revoke points or anything else from anyone at our discretion to comply with law.";
const MAIN_BLOB = "/blob/main/";
const BRANCH_BLOB = "/blob/grok/stranded-tester-early-access/";
const POINTS =
  "Testing is optional and at your own risk. Use only free testnet tokens. They have no value. Do not connect a wallet that holds real funds. We do not ask you to deposit funds. Testers can earn points for testing. Points have no cash or monetary value, are not transferable, cannot be sold or exchanged, and are not tokens, securities or a promise of any future token, airdrop or payment. Points are not earned by depositing funds or by the amount of funds used. We may change or end the points program at any time.";
const POINTS_BASIS = "Points are per task or per bug reported, never per amount or volume.";
const NO_PRIZES = "There are no leaderboards, ranks, or prizes.";
const TERMS_ITEM_2 = `${POINTS} ${POINTS_BASIS} There are no leaderboards, ranks or prizes.`;
const TERMS_ITEM_6 =
  "Stranded is testnet only. Use only free testnet tokens, which have no value. Do not connect a wallet that holds real funds.";
const NO_OFFER = "Nothing here is an offer of tokens, value or any investment.";
const AIRDROP_DECISION =
  "We have not decided whether any airdrop will happen. No airdrop is promised, and there is no amount, date or schedule.";
const AIRDROP_ITEM_1 =
  "No airdrop, token or other distribution is promised. We make no guarantee that any will ever occur, or of any amount, timing or form.";
const AIRDROP_ITEM_2 = "Any token or other distribution has no promised monetary value.";
const AIRDROP_INTEREST =
  "Registering interest does not make you eligible for anything and does not reserve anything for you.";
const AIRDROP_SEPARATE = "Testing, points and any use of the app have no bearing on this page.";
const AIRDROP_SANCTIONS =
  "You may not take part if you are in a jurisdiction subject to comprehensive U.S. sanctions, or if you are on a U.S. sanctions list, including OFAC's SDN List.";
const AIRDROP_SEE_HTML =
  'See the <a href="tester-terms.html">Tester Terms</a>, <a href="privacy-notice.html">Privacy Notice</a> and <a href="sanctions.html">Sanctioned Jurisdictions</a> pages.';
const AIRDROP_META =
  "Draft. No airdrop is promised. No amount, date or schedule. Interest is not eligibility.";
const SECURITY_REPORT =
  "A valid report can earn tester points, awarded per report and never by severity payout or funds involved. Points have no cash value, are non-transferable and are not tokens. There is no paid bug bounty. Report security issues privately as described above, not in a public issue.";
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
    "../public/airdrop-terms.html",
  ],
  { eager: true },
);

function expectClean(text: string) {
  for (const phrase of ABSENT) expect(text).not.toContain(phrase);
  expect(text).not.toContain(RETIRED_PRODUCTION);
  expect(text).not.toContain("/points/leaderboard");
}

describe("unpublished tester page", () => {
  it("keeps the draft page and sitemap out of the published site", () => {
    expectClean(page);
    expect(page).toContain(MARKER);
    expect(page).toContain(PRIVACY);
    expect(page).toContain(ELIGIBILITY);
    expect(page).toContain(PUBLIC_NOTE);
    expect(page).toContain(HANDLE_ONLY);
    expect(page).toContain(SIGNUP);
    expect(page).toContain(TESTNET_ONLY);
    expect(page).not.toContain(RETIRED_WALLET_LINE);
    expect(page).not.toContain(BRANCH_BLOB);
    expect(page).toContain(MAIN_BLOB);
    expect(page).not.toContain("/raw/grok/stranded-tester-early-access/");
    expect(page).toContain(POINTS);
    expect(page).toContain(POINTS_BASIS);
    expect(page).toContain(NO_PRIZES);
    expect(page).toContain(NO_OFFER);
    expect(page).not.toMatch(RETIRED_EARN);
    expect(page).not.toContain("strandedtoken.trade");
    expect(page).toContain('href="tester-terms.html"');
    expect(page).toContain('href="privacy-notice.html"');
    expect(page).toContain('href="sanctions.html"');
    expect(page).not.toContain('href="airdrop-interest.html"');
    expect(page).not.toContain('href="airdrop-terms.html"');
    expect(page).not.toContain("use small amounts");
    expect(page).not.toContain("No guaranteed value");
    for (const draft of [terms, privacy, sanctions, airdropTerms]) {
      expect(draft).toContain(MARKER);
      expect(draft).toContain("DRAFT");
      expect(draft).toContain('name="robots" content="noindex, nofollow"');
      expectClean(draft);
    }
    expect(terms).toContain("<h1>Tester Terms (DRAFT)</h1>");
    expect(terms).not.toContain("Tester and Airdrop Terms");
    expect(terms).toContain(TERMS_ITEM_2);
    expect(terms).toContain(TERMS_ITEM_6);
    expect(terms).toContain(CHANGES);
    expect(terms).not.toContain("these terms or any recognition");
    expect(privacy).toContain(RETENTION);
    expect(privacy).not.toContain("any related recognition");
    expect(sanctions).toContain(SANCTIONS_PARTICIPATE);
    expect(sanctions).toContain(SANCTIONS_DISCRETION);
    expect(sanctions).not.toContain(["withhold or revoke", "recognition"].join(" "));
    expect(sanctions).not.toContain("receive any recognition from");
    expect(terms).not.toContain("airdrop-interest.html");
    expect(terms).not.toContain("airdrop-terms.html");
    expect(terms).toContain("Testnet ETH and testnet tokens");
    expect(terms).toContain("You must be at least 18 years old");
    expect(airdropTerms).toContain("<h1>Airdrop Interest Terms (DRAFT)</h1>");
    expect(airdropTerms).toContain(AIRDROP_ITEM_1);
    expect(airdropTerms).toContain(AIRDROP_ITEM_2);
    expect(airdropTerms).not.toContain(AIRDROP_DECISION);
    expect(airdropTerms).toContain("No monetary value; not an investment.");
    expect(airdropTerms).toContain('href="airdrop-interest.html"');
    expect(airdropTerms).not.toContain("tester-early-access.html");
    expect(airdropTerms).not.toContain("tester-terms.html");
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
    expectClean(airdrop);
    expect(airdrop).toContain(MARKER);
    expect(airdrop).toContain(AIRDROP_DECISION);
    expect(airdrop).toContain(AIRDROP_INTEREST);
    expect(airdrop).toContain(AIRDROP_SEPARATE);
    expect(airdrop).toContain(AIRDROP_SANCTIONS);
    expect(airdrop).toContain(AIRDROP_SEE_HTML);
    expect(airdrop).toContain(AIRDROP_META);
    expect(airdrop).toContain(NO_OFFER);
    expect(airdrop).toContain('href="airdrop-terms.html"');
    expect(airdrop).toContain('href="tester-terms.html"');
    expect(airdrop).toContain('href="privacy-notice.html"');
    expect(airdrop).toContain('href="sanctions.html"');
    expect(airdrop).not.toContain("tester-early-access.html");
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
    expect(airdrop).not.toContain("strandedtoken.trade");
    expect(airdrop).not.toContain("/raw/grok/stranded-tester-early-access/");
    expect(airdrop).not.toMatch(RETIRED_EARN);
    for (const source of [page, airdrop, airdropTerms, terms, privacy, sanctions, sitemap]) {
      expect(source).not.toContain(BRANCH_BLOB);
      expect(source).toContain(MAIN_BLOB);
    }
    expect(security).toContain(SECURITY_REPORT);
    expectClean(security);
    expect(sitemap).toContain("wallet/staging/tester-early-access.html");
    expect(sitemap).toContain("wallet/staging/airdrop-interest.html");
    expect(sitemap).toContain("wallet/staging/airdrop-terms.html");
    expect(sitemap).not.toContain("strandedtoken.trade");
    expect(sitemap).not.toContain("/points/leaderboard");
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
      expect(text).not.toContain("airdrop-terms");
    }
    expect(renderSource).toContain("staticPublishPath: wallet/dist");
  });

  it("collects only the GitHub handle on the public sign-up form", () => {
    expectClean(signup);
    expect(signup).toContain(MARKER);
    expect(signup).toContain(PRIVACY);
    expect(signup).toContain(ELIGIBILITY);
    expect(signup).toContain(PUBLIC_NOTE);
    expect(signup).toContain(HANDLE_ONLY);
    expect(signup).toContain(TESTNET_ONLY);
    expect(signup).not.toContain(RETIRED_WALLET_LINE);
    expect(signup).not.toContain(BRANCH_BLOB);
    expect(signup).toContain(MAIN_BLOB);
    expect(signup).toContain(POINTS);
    expect(signup).toContain(POINTS_BASIS);
    expect(signup).toContain(NO_PRIZES);
    expect(signup).toContain(NO_OFFER);
    expect(signup).not.toMatch(RETIRED_EARN);
    expect(signup).not.toContain("strandedtoken.trade");
    expect(signup).not.toContain("airdrop-interest");
    expect(signup).not.toContain("airdrop-terms");
    expect(signup).toContain(SANCTIONS_ATTESTATION);
    expect(signup).toContain(FORM_DESCRIPTION);
    expect(signup).toContain("wallet/staging/tester-terms.html");
    expect(signup).toContain("wallet/staging/privacy-notice.html");
    expect(signup).toContain("wallet/staging/sanctions.html");
    expect(signup).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(signup).not.toMatch(/type: (textarea|dropdown|input)\b/);
    expect(signup.match(/type: checkboxes/g)).toEqual(["type: checkboxes"]);
    const ids = [...signup.matchAll(/^ {4}id: (\S+)/gm)].map((match) => match[1]);
    expect(ids).toEqual(["sanctions-and-terms"]);
    expect(signup).not.toMatch(/^ {4}id: email$/m);
    expect(signup).not.toMatch(/^ {4}id: wallet-address$/m);
    expect(signup).toMatch(/id: sanctions-and-terms[\s\S]*required: true/);
  });

  it("puts the draft notice in the README without a live-site link", () => {
    const start = readme.indexOf("## Tester / early access");
    const end = readme.indexOf("## Phase-2 scaffold");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(readme).not.toContain("## Airdrop interest");
    const section = readme.slice(start, end);
    expectClean(section);
    expect(section).toContain(MARKER);
    expect(section).toContain(PRIVACY);
    expect(section).toContain(ELIGIBILITY);
    expect(section).toContain(PUBLIC_NOTE);
    expect(section).toContain(HANDLE_ONLY);
    expect(section).toContain(SIGNUP);
    expect(section).toContain(TESTNET_ONLY);
    expect(section).not.toContain(RETIRED_WALLET_LINE);
    expect(section).toContain(POINTS);
    expect(section).toContain(POINTS_BASIS);
    expect(section).toContain(NO_PRIZES);
    expect(section).toContain(NO_OFFER);
    expect(section).not.toMatch(RETIRED_EARN);
    expect(section).not.toContain("strandedtoken.trade");
    expect(section).not.toContain("airdrop-terms.html");
    expect(section).not.toContain("airdrop-interest.html");
    expect(readme).not.toContain("wallet/staging/airdrop-interest.html");
    expect(readme).not.toContain("wallet/staging/airdrop-terms.html");
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
