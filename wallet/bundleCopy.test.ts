import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutputChunk, RollupOutput } from "rollup";
import { transformSync } from "esbuild";
import { build, type Plugin } from "vite";
import {
  bannedHitsInText,
  bannedWordsIn,
  cssContentHits,
  extractStringLiterals,
  foldConcatenatedStrings,
  formatBannedHits,
  hitsInAppCode,
  isWholeBannedForm,
  unsafeRedirects,
  type BannedHit,
} from "./src/lib/bannedWords";

const walletRoot = path.dirname(fileURLToPath(import.meta.url));

function normalize(id: string): string {
  return id.replaceAll("\\", "/");
}

const BINARY_EXT = new Set([
  ".webp", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm", ".wasm", ".bin", ".pdf", ".zip",
]);

function walk(dir: string, accept: (name: string) => boolean, seen = new Set<string>()): string[] {
  let real = dir;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return [];
  }
  if (seen.has(real)) return [];
  seen.add(real);
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const st = fs.statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) found.push(...walk(full, accept, seen));
    else if (isFile && accept(entry.name)) found.push(full);
  }
  return found;
}

function isBinaryPath(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  if (BINARY_EXT.has(ext)) return true;
  const handle = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(8000);
    const n = fs.readSync(handle, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    fs.closeSync(handle);
  }
}

/** Vendor code is the top-level node_modules tree. A node_modules folder under src stays app code. */
function isVendorModuleId(id: string): boolean {
  const norm = normalize(id);
  const marker = "/node_modules/";
  const srcRoot = `${normalize(walletRoot)}/src`;
  let from = 0;
  while (from < norm.length) {
    const at = norm.indexOf(marker, from);
    if (at === -1) return false;
    const before = norm.slice(0, at);
    const nestedInSrc = before === srcRoot || before.startsWith(`${srcRoot}/`);
    if (!nestedInSrc) return true;
    from = at + marker.length;
  }
  return false;
}

function isAppModuleId(id: string): boolean {
  const norm = normalize(id);
  if (!norm || norm.includes("\0")) return false;
  return !isVendorModuleId(norm);
}

/** The gate QA blocked: a one-word literal was skipped unless it was an exact banned form. */
function legacyOneWordGate(code: string, file: string): BannedHit[] {
  const folded = foldConcatenatedStrings(code);
  const hits: BannedHit[] = [];
  for (const literal of extractStringLiterals(folded)) {
    const trimmed = literal.text.trim();
    if (!trimmed) continue;
    if (!/\s/.test(trimmed) && !isWholeBannedForm(trimmed)) continue;
    hits.push(...bannedHitsInText(trimmed, file));
  }
  return hits;
}

type BuiltModule = { id: string; code: string; chunkFile: string };

function chunksOf(output: RollupOutput["output"]): OutputChunk[] {
  return output.filter((item): item is OutputChunk => item.type === "chunk");
}

function appModules(output: RollupOutput["output"]): BuiltModule[] {
  const found: BuiltModule[] = [];
  for (const chunk of chunksOf(output)) {
    for (const [id, mod] of Object.entries(chunk.modules)) {
      if (!isAppModuleId(id)) continue;
      if (typeof mod.code !== "string" || mod.code.length === 0) continue;
      found.push({ id, code: mod.code, chunkFile: chunk.fileName });
    }
  }
  return found;
}

function textsFromDataUris(code: string): string[] {
  const found: string[] = [];
  const pattern = /data:([^,;]*)(;base64)?,([A-Za-z0-9+/=%._~-]{4,})/g;
  for (const match of code.matchAll(pattern)) {
    const mime = (match[1] ?? "").toLowerCase();
    const textual =
      mime.length === 0 ||
      mime.startsWith("text/") ||
      mime === "image/svg+xml" ||
      mime === "application/json" ||
      mime === "application/xml" ||
      mime.endsWith("+xml") ||
      mime.endsWith("+json");
    if (!textual) continue;
    try {
      const text = match[2] ? Buffer.from(match[3] ?? "", "base64").toString("utf8") : decodeURIComponent(match[3] ?? "");
      if (text && !text.includes("\0")) found.push(text);
    } catch {
      // A data URI that does not decode is not text copy.
    }
  }
  return found;
}

function scanAppModules(output: RollupOutput["output"]): BannedHit[] {
  return appModules(output).flatMap((mod) => {
    const rel = path.relative(walletRoot, mod.id).split(path.sep).join("/");
    const label = `${mod.chunkFile} (${rel})`;
    const hits = hitsInAppCode(mod.code, label);
    for (const text of textsFromDataUris(mod.code)) {
      hits.push(...bannedHitsInText(text, `${label} data-uri`));
    }
    return hits;
  });
}

function scanCopiedText(outDir: string, output: RollupOutput["output"]): BannedHit[] {
  const chunkNames = new Set(chunksOf(output).map((chunk) => chunk.fileName.split(path.sep).join("/")));
  const hits: BannedHit[] = [];
  if (!fs.existsSync(outDir)) return hits;
  for (const file of walk(outDir, () => true)) {
    if (isBinaryPath(file)) continue;
    const rel = path.relative(outDir, file).split(path.sep).join("/");
    if (chunkNames.has(rel) || rel.endsWith(".css")) continue;
    const text = fs.readFileSync(file, "utf8");
    hits.push(...bannedHitsInText(text, rel));
    if (path.basename(file) === "_redirects") {
      for (const bad of unsafeRedirects(text, rel)) {
        hits.push({ stem: "redirect", match: bad.target, excerpt: bad.line, file: rel });
      }
    }
  }
  return hits;
}

function scanCssContent(outDir: string): BannedHit[] {
  return walk(outDir, (name) => name.endsWith(".css")).flatMap((file) => {
    const rel = path.relative(outDir, file).split(path.sep).join("/");
    return cssContentHits(fs.readFileSync(file, "utf8"), rel);
  });
}

function jsxText(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const found: string[] = [];
  for (const match of withoutComments.matchAll(/>([^<>{}]+)</g)) {
    const text = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (text) found.push(text);
  }
  return found;
}

async function buildWallet(outDir: string, extra: { plugins?: Plugin[]; publicDir?: string } = {}) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let mode = "";
  const modePlugin: Plugin = {
    name: "record-build-mode",
    configResolved(config) {
      mode = config.mode;
    },
  };
  try {
    const result = await build({
      root: walletRoot,
      mode: "production",
      configFile: path.join(walletRoot, "vite.config.ts"),
      plugins: [modePlugin, ...(extra.plugins ?? [])],
      publicDir: extra.publicDir,
      build: {
        outDir,
        emptyOutDir: true,
      },
      logLevel: "silent",
    });
    if (Array.isArray(result) || !result || !("output" in result)) {
      throw new Error("expected a Vite Rollup build");
    }
    if (mode !== "production" || process.env.NODE_ENV !== "production") {
      throw new Error(`copy scan expected a production build, mode=${mode} NODE_ENV=${process.env.NODE_ENV}`);
    }
    return result;
  } finally {
    process.env.NODE_ENV = previous;
  }
}

const priceLabel = ["Pri", "ce", ":"].join("");
const apyLabel = ["AP", "Y", ":"].join("");
const rewardsLabel = ["Re", "wards", "!"].join("");
const earnLabel = `(${["ea", "rn"].join("")})`;

describe("banned-word scanner", () => {
  const phrase = ["Claim your ", "air", "drop", " today"].join("");
  const inflection = ["re", "wards"].join("");

  it("flags a string constant and prints the text and the file", () => {
    const hits = hitsInAppCode(`export const label = ${JSON.stringify(phrase)};`, "format.ts");
    const message = formatBannedHits(hits);
    expect(message).toContain("format.ts");
    expect(message).toContain(phrase);
    expect(hits.map((hit) => hit.stem)).toContain("airdrop");
  });

  it("keeps the failure excerpt to 48 characters on either side", () => {
    const word = ["pri", "ce"].join("");
    const text = `${".".repeat(80)}${word}${"!".repeat(80)}`;
    const hit = bannedHitsInText(text, "copy.ts")[0];
    expect(hit?.excerpt).toBe(`${".".repeat(48)}${word}${"!".repeat(48)}`);
  });

  it("flags inflections of every stem and leaves the clean words alone", () => {
    expect(bannedWordsIn(inflection)).toEqual(["reward"]);
    expect(bannedWordsIn(["earn", "ed"].join(""))).toEqual(["earn"]);
    expect(bannedWordsIn(["earn", "ing"].join(""))).toEqual(["earn"]);
    expect(bannedWordsIn(["earn", "s"].join(""))).toEqual(["earn"]);
    expect(bannedWordsIn(["earn", "ings"].join(""))).toEqual(["earn"]);
    expect(bannedWordsIn(["air", "drop", "s"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "drop", "ped"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["trad", "ing"].join(""))).toEqual(["trade"]);
    expect(bannedWordsIn(["pric", "ed"].join(""))).toEqual(["price"]);
    expect(bannedWordsIn(["valu", "ing"].join(""))).toEqual(["value"]);
    expect(bannedWordsIn(["in", "vestment"].join(""))).toEqual(["invest"]);
    expect(bannedWordsIn(["in", "vestor"].join(""))).toEqual(["invest"]);
    expect(bannedWordsIn(["in", "vestors"].join(""))).toEqual(["invest"]);
    expect(bannedWordsIn(["trad", "er"].join(""))).toEqual(["trade"]);
    expect(bannedWordsIn(["trad", "able"].join(""))).toEqual(["trade"]);
    expect(bannedWordsIn(["valu", "able"].join(""))).toEqual(["value"]);
    expect(bannedWordsIn(["profit", "able"].join(""))).toEqual(["profit"]);
    expect(bannedWordsIn(["list", "ed"].join(""))).toEqual(["listing"]);
    expect(bannedWordsIn(["pre-", "sale"].join(""))).toEqual(["presale"]);
    expect(bannedWordsIn(["pre ", "sale"].join(""))).toEqual(["presale"]);
    expect(bannedWordsIn(["profit", "ability"].join(""))).toEqual(["profit"]);
    expect(bannedWordsIn(["trade", "able"].join(""))).toEqual(["trade"]);
    expect(bannedWordsIn("learn yearn earnest unearned valuation tradeoff")).toEqual([]);
  });

  it("fails hyphenated and joined forms, including a non-breaking hyphen", () => {
    const airdropEligible = ["Air", "drop", "-eligible"].join("");
    const rewardReady = ["Re", "ward", "-ready"].join("");
    const airDrop = ["air", "-drop"].join("");
    const nbPreSale = ["pre", "\u2011", "sale"].join("");
    expect(bannedWordsIn(airdropEligible)).toEqual(["airdrop"]);
    expect(bannedWordsIn(rewardReady)).toEqual(["reward"]);
    expect(bannedWordsIn(airDrop)).toEqual(["airdrop"]);
    expect(bannedWordsIn(nbPreSale)).toEqual(["presale"]);
    expect(bannedWordsIn(["air", "\u200B", "drop"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn("\uFF50\uFF52\uFF49\uFF43\uFF45")).toEqual(["price"]);
    expect(bannedWordsIn(["re", "ward", "_ready"].join(""))).toEqual(["reward"]);
    expect(bannedWordsIn(["re", "_", "ward"].join(""))).toEqual(["reward"]);
    expect(bannedWordsIn(["in", "-", "vest"].join(""))).toEqual(["invest"]);
    expect(bannedWordsIn(["tra", "de", "-off"].join(""))).toEqual([]);
    expect(bannedWordsIn(["no", "-", "value"].join(""))).toEqual([]);
    expect(bannedWordsIn(["no", "_", "value"].join(""))).toEqual([]);
    expect(bannedWordsIn(["data", "-", "value"].join(""))).toEqual([]);
    expect(bannedWordsIn(["pri", "ce", "_id"].join(""))).toEqual([]);
    expect(bannedWordsIn("valuation tradeoff")).toEqual([]);
  });

  it("flags slash-separated copy and still scans Price:/month", () => {
    const slashList = ["Track points/", "re", "wards/", "air", "drops in one place"].join("");
    const buySell = ["Buy/sell/", "tra", "de"].join("");
    const claim = ["/", "air", "drop", "/claim"].join("");
    const priceMonth = ["Pri", "ce", ":/month"].join("");
    expect(bannedWordsIn(slashList).sort()).toEqual(["airdrop", "reward"]);
    expect(bannedWordsIn(buySell)).toEqual(["trade"]);
    expect(bannedWordsIn(claim)).toEqual(["airdrop"]);
    expect(bannedWordsIn(priceMonth)).toEqual(["price"]);
    expect(bannedWordsIn(`pkg/node_modules/left/${["re", "wards"].join("")}.js`)).toEqual([]);
    expect(bannedWordsIn(["Air", "drop", "!node_modules"].join(""))).toEqual(["airdrop"]);
    expect(hitsInAppCode(`export const label = ${JSON.stringify(slashList)};`, "format.ts").length).toBeGreaterThan(0);
  });

  it("strips default-ignorable characters, including a JSX soft hyphen", () => {
    expect(bannedWordsIn(["air", "\u00AD", "drop"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "\u034F", "drop"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "\u200E", "drop"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "\u2061", "drop"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "\u2062", "drop"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "\uFE0F", "drop"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "\u2E3A", "drop"].join(""))).toEqual(["airdrop"]);
    const jsx = transformSync("export function L(){return <span>air&shy;drop</span>}", {
      loader: "tsx",
      jsx: "automatic",
    }).code;
    const hits = hitsInAppCode(jsx, "Shy.tsx");
    expect(hits.map((hit) => hit.stem)).toContain("airdrop");
  });

  it("passes a checkout path that contains rewards", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rewards-checkout-"));
    try {
      const file = path.join(root, "wallet", "src", "App.tsx");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const source = fs.readFileSync(path.join(walletRoot, "src", "App.tsx"), "utf8");
      fs.writeFileSync(file, source);
      const withPath = `${source}\nexport const builtFrom = ${JSON.stringify(file)};\n`;
      const hits = hitsInAppCode(withPath, file);
      expect(hits, formatBannedHits(hits)).toEqual([]);
      expect(bannedHitsInText(file, file)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags an external redirect target", () => {
    const line = ["/go", "https://example.invalid/out", "302"].join(" ");
    const hits = unsafeRedirects(`# note\n/points /index.html 200\n${line}\n`, "_redirects");
    expect(hits).toEqual([{ file: "_redirects", line, target: "https://example.invalid/out" }]);
    expect(unsafeRedirects("/points /index.html 200\n/* /index.html 200\n", "_redirects")).toEqual([]);
  });

  it("rejects protocol-relative, backslash, placeholder, encoded, CR, and proxy targets", () => {
    const cases = [
      ["/go", "//evil.example/out", "302"],
      ["/go", "/\\evil.example", "302"],
      ["/go/*", "/:splat", "302"],
      ["/go/:host", "/:host", "302"],
      ["/go", "/%2Fevil.example", "302"],
      ["/go", "/%5Cevil.example", "302"],
      ["/api/*", "//evil.example/:splat", "200!"],
    ];
    for (const parts of cases) {
      const line = parts.join(" ");
      const hits = unsafeRedirects(`${line}\n`, "_redirects");
      expect(hits, line).toHaveLength(1);
      expect(hits[0]?.target).toBe(parts[1]);
    }
    const hidden = ["/x", "https://example.invalid/out", "302"].join(" ");
    const cr = `/a /index.html 200\r${hidden}`;
    const crHits = unsafeRedirects(cr, "_redirects");
    expect(crHits).toHaveLength(1);
    expect(crHits[0]?.target).toBe("https://example.invalid/out");
  });

  it("flags a static concatenation and documents the runtime-join limit", () => {
    const folded = hitsInAppCode('export const visible = "air" + "drop";', "format.ts");
    expect(formatBannedHits(folded)).toContain("format.ts");
    expect(folded.some((hit) => hit.stem === "airdrop")).toBe(true);
    const runtime = hitsInAppCode('export const hidden = ["air", "drop"].join("");', "format.ts");
    expect(runtime, `${formatBannedHits(runtime)}\nA runtime join is not a static string, so this scanner cannot see it.`).toEqual(
      [],
    );
  });

  it("skips the permit field name and still flags another value literal", () => {
    const code = [
      'const permit={name:"value",type:"uint256"};',
      'const pad="................................................";',
      'const other="value";',
    ].join("");
    const hits = hitsInAppCode(code, "order.ts");
    expect(formatBannedHits(hits)).toContain("order.ts");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.match).toBe("value");
  });

  it("the previous one-word gate exits clean on punctuated labels and the new scan does not", () => {
    const source = [
      `export function Label(){return <span>{${JSON.stringify(priceLabel)}}</span>}`,
      `export const rewards = ${JSON.stringify(rewardsLabel)};`,
      `export const apy = ${JSON.stringify(apyLabel)};`,
      `export const earn = ${JSON.stringify(earnLabel)};`,
    ].join("\n");
    const previous = legacyOneWordGate(source, "App.tsx");
    expect(previous, formatBannedHits(previous)).toEqual([]);
    const hits = hitsInAppCode(source, "App.tsx");
    expect(hits.map((hit) => hit.stem).sort()).toEqual(["apy", "earn", "price", "reward"]);
    expect(hits.find((hit) => hit.stem === "price")?.excerpt).toBe(priceLabel);
    expect(hits.find((hit) => hit.stem === "reward")?.excerpt).toBe(rewardsLabel);
    expect(hits.find((hit) => hit.stem === "apy")?.excerpt).toBe(apyLabel);
    expect(hits.find((hit) => hit.stem === "earn")?.excerpt).toBe(earnLabel);
    expect(formatBannedHits(hits)).toContain("App.tsx");
  });

  it("reads CSS content values and ignores justify-content", () => {
    const css = `.row{justify-content:center}.plant{content:${JSON.stringify(rewardsLabel)}}`;
    const hits = cssContentHits(css, "index.css");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.stem).toBe("reward");
    expect(hits[0]?.file).toBe("index.css");
    expect(hits[0]?.excerpt).toBe(rewardsLabel);
    expect(cssContentHits(".row{justify-content:center}", "index.css")).toEqual([]);
  });

  it("reads a JSON document and a text file", () => {
    const earnings = ["earn", "ings"].join("");
    const trader = ["trad", "er"].join("");
    const jsonHits = bannedHitsInText(JSON.stringify({ note: earnings }), "notice.json");
    expect(jsonHits.map((hit) => hit.file)).toEqual(["notice.json"]);
    expect(jsonHits[0]?.stem).toBe("earn");
    const textHits = bannedHitsInText(trader, "notice.txt");
    expect(textHits.map((hit) => hit.file)).toEqual(["notice.txt"]);
    expect(textHits[0]?.stem).toBe("trade");
  });
});

describe("built app chunks", () => {
  it("scans production app modules, copied text, and CSS content", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-bundle-"));
    try {
      const built = await buildWallet(outDir);
      const chunks = chunksOf(built.output);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => !path.basename(chunk.fileName).startsWith("vendor"))).toBe(true);

      const mixed = chunks.find((chunk) => {
        const ids = Object.keys(chunk.modules);
        return ids.some(isAppModuleId) && ids.some(isVendorModuleId);
      });
      expect(mixed, "production chunking keeps app and vendor modules in one chunk").toBeDefined();
      expect(normalize(mixed?.facadeModuleId ?? "")).toMatch(/\/index\.html$/);
      expect(isAppModuleId(path.join(walletRoot, "src/pkg/node_modules/left/index.js"))).toBe(true);
      expect(isAppModuleId(path.resolve(walletRoot, "../shared/quote.ts"))).toBe(true);
      expect(isAppModuleId(path.join(walletRoot, "node_modules/viem/index.js"))).toBe(false);
      expect(mixed?.code).toMatch(/\bvalue\b/);
      const naive = hitsInAppCode(mixed?.code ?? "", mixed?.fileName ?? "chunk.js");
      expect(naive.length, "the mixed chunk still contains vendor copy").toBeGreaterThan(0);

      const vendorOnly = chunks.filter((chunk) => {
        const ids = Object.keys(chunk.modules);
        return ids.length > 0 && ids.every((id) => !isAppModuleId(id));
      });
      expect(vendorOnly.length).toBeGreaterThan(0);
      expect(normalize(vendorOnly[0]?.facadeModuleId ?? "")).toMatch(/node_modules/);

      const appHits = scanAppModules(built.output);
      expect(appHits, formatBannedHits(appHits)).toEqual([]);
      expect(appModules(built.output).length).toBeGreaterThan(0);

      const publicDir = path.join(walletRoot, "public");
      const copied = scanCopiedText(outDir, built.output);
      expect(fs.existsSync(path.join(publicDir, "_redirects"))).toBe(true);
      expect(copied, formatBannedHits(copied)).toEqual([]);
      const cssHits = scanCssContent(outDir);
      expect(walk(outDir, (name) => name.endsWith(".css")).length).toBeGreaterThan(0);
      expect(cssHits, formatBannedHits(cssHits)).toEqual([]);

      const sources = walk(path.join(walletRoot, "src"), (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"));
      const jsxHits = sources.flatMap((file) =>
        jsxText(fs.readFileSync(file, "utf8")).flatMap((line) =>
          bannedWordsIn(line).map((stem) => `${path.basename(file)}: "${line}" matched ${stem}`),
        ),
      );
      expect(jsxHits, jsxHits.join("\n")).toEqual([]);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    expect(fs.existsSync(outDir)).toBe(false);
  }, 90_000);
});

describe("planted bundle copy", () => {
  const phrase = ["Claim your ", "air", "drop", " today"].join("");
  const dropped = ["air", "drop"].join("");
  const inflection = ["re", "wards"].join("");
  const earnings = ["earn", "ings"].join("");
  const trader = ["trad", "er"].join("");
  const profitable = ["profit", "able"].join("");
  const airdropEligible = ["Air", "drop", "-eligible"].join("");
  const rewardReady = ["Re", "ward", "-ready"].join("");
  const airDrop = ["air", "-drop"].join("");
  const nbPreSale = ["pre", "\u2011", "sale"].join("");
  const sharedWord = ["list", "ed"].join("");
  const manifestWord = ["profit", "ability"].join("");
  const svgWord = ["trade", "able"].join("");
  const htmlWord = ["in", "vestors"].join("");
  const cssVar = ["re", "ward"].join("");
  const headerWord = ["air", "drop"].join("");
  const scriptWord = ["pre", "sale"].join("");
  const moduleWord = ["re", "wards"].join("");
  const csvWord = ["air", "drops"].join("");
  const feedWord = ["list", "ed"].join("");
  const xhtmlWord = ["valu", "able"].join("");
  const calendarWord = ["in", "vestors"].join("");
  const yamlWord = ["AP", "Y"].join("");
  const licenseWord = ["earn", "ings"].join("");
  const linkWord = ["profit", "able"].join("");
  const smallWord = ["earn", "ings"].join("");
  const logoWord = ["valu", "able"].join("");
  const docWord = ["trad", "ers"].join("");
  const workerWord = ["pre", "sale"].join("");
  const bigWord = ["air", "drop"].join("");
  const sharedId = path.resolve(walletRoot, "../shared/planted-copy.ts");
  let outDir = "";
  let publicDir = "";
  let outsideDir = "";
  const assetRoot = path.join(walletRoot, "src", "plant-scope");
  let hits: BannedHit[] = [];
  let copied: BannedHit[] = [];
  let output: RollupOutput["output"] = [];

  function plantPlugin(): Plugin {
    return {
      name: "plant-banned-copy",
      enforce: "pre",
      resolveId(source) {
        if (source === "../shared/planted-copy") return sharedId;
        return null;
      },
      load(id) {
        if (normalize(id) !== normalize(sharedId)) return null;
        return `Object.assign(globalThis, { sharedPlant: ${JSON.stringify(sharedWord)} });\n`;
      },
      transformIndexHtml(html) {
        return html.replace("</body>", `<p>${htmlWord}</p></body>`);
      },
      transform(code, id) {
        const norm = normalize(id);
        if (norm.endsWith("/src/App.tsx")) {
          const anchor = "<h2>3. Stranded token</h2>";
          if (!code.includes(anchor)) return null;
          const jsx = `<span>{${JSON.stringify(priceLabel)}}</span>`;
          const extra = [
            "Object.assign(globalThis, {",
            `__plantRewards: ${JSON.stringify(rewardsLabel)},`,
            `__plantApy: ${JSON.stringify(apyLabel)},`,
            `__plantEarn: ${JSON.stringify(earnLabel)},`,
            "});",
          ].join("\n");
          const withImport = [
            'import "../shared/planted-copy";',
            'import plantTerms from "./plant-scope/terms.html?url";',
            'import plantSmall from "./plant-scope/small.txt?url";',
            'import plantLogo from "./plant-scope/logo.svg";',
            code.replace(anchor, `${anchor}${jsx}`),
          ].join("\n");
          const sideEffects = [
            extra,
            "Object.assign(globalThis, { plantTerms, plantSmall, plantLogo, plantDoc: new URL(\"./plant-scope/doc.md\", import.meta.url).href });",
            'new Worker(new URL("./plant-scope/worker.ts", import.meta.url), { type: "module" });',
          ].join("\n");
          return { code: `${withImport}\n${sideEffects}\n`, map: null };
        }
        if (norm.endsWith("/src/lib/format.ts")) {
          const extra = [
            "Object.assign(globalThis, {",
            `__plantedConstant: ${JSON.stringify(phrase)},`,
            `__plantedInflection: ${JSON.stringify(inflection)},`,
            `__plantHyphenA: ${JSON.stringify(airdropEligible)},`,
            `__plantHyphenB: ${JSON.stringify(rewardReady)},`,
            `__plantHyphenC: ${JSON.stringify(airDrop)},`,
            `__plantHyphenD: ${JSON.stringify(nbPreSale)},`,
            '__plantedSplit: "air" + "drop"',
            "});",
          ].join("\n");
          return { code: `${code}\n${extra}\n`, map: null };
        }
        if (norm.endsWith("/src/index.css")) {
          return {
            code: `${code}\n.plant{content:${JSON.stringify(profitable)};}\n:root{--plant-label:${JSON.stringify(cssVar)};}\n`,
            map: null,
          };
        }
        return null;
      },
    };
  }

  beforeAll(async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-plant-"));
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-public-"));
    fs.writeFileSync(path.join(publicDir, "notice.json"), JSON.stringify({ note: earnings }));
    fs.writeFileSync(path.join(publicDir, "notice.txt"), `${trader}\n`);
    fs.writeFileSync(
      path.join(publicDir, "site.webmanifest"),
      JSON.stringify({ name: manifestWord }),
    );
    fs.writeFileSync(path.join(publicDir, "mark.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><text>${svgWord}</text></svg>\n`);
    fs.writeFileSync(
      path.join(publicDir, "_redirects"),
      ["/go", "https://example.invalid/out", "302"].join(" ") + "\n",
    );
    fs.writeFileSync(path.join(publicDir, "_headers"), `/*\n  X-Note: ${headerWord}\n`);
    fs.writeFileSync(path.join(publicDir, "note.js"), `document.title=${JSON.stringify(scriptWord)};\n`);
    fs.writeFileSync(path.join(publicDir, "app.mjs"), `export const label = ${JSON.stringify(moduleWord)};\n`);
    fs.writeFileSync(path.join(publicDir, "notice.csv"), `a,${csvWord}\n`);
    fs.writeFileSync(path.join(publicDir, "feed.rss"), `<rss><title>${feedWord}</title></rss>\n`);
    fs.writeFileSync(path.join(publicDir, "page.xhtml"), `<p>${xhtmlWord}</p>\n`);
    fs.writeFileSync(path.join(publicDir, "cal.ics"), `SUMMARY:${calendarWord}\n`);
    fs.writeFileSync(path.join(publicDir, "notes.yaml"), `title: ${yamlWord}\n`);
    fs.writeFileSync(path.join(publicDir, "LICENSE"), `${licenseWord}\n`);
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "plant-outside-"));
    fs.writeFileSync(path.join(outsideDir, "notes.txt"), `${linkWord}\n`);
    fs.symlinkSync(outsideDir, path.join(publicDir, "linkdir"));
    fs.mkdirSync(assetRoot, { recursive: true });
    fs.writeFileSync(path.join(assetRoot, "terms.html"), `<p>${bigWord}</p>\n${"x".repeat(5000)}\n`);
    fs.writeFileSync(path.join(assetRoot, "small.txt"), `${smallWord}\n`);
    fs.writeFileSync(path.join(assetRoot, "logo.svg"), `<svg><text>${logoWord}</text></svg>\n`);
    fs.writeFileSync(path.join(assetRoot, "doc.md"), `# ${docWord}\n`);
    fs.writeFileSync(path.join(assetRoot, "worker.ts"), `Object.assign(globalThis, { workerPlant: ${JSON.stringify(workerWord)} });\n`);
    const built = await buildWallet(outDir, { plugins: [plantPlugin()], publicDir });
    output = built.output;
    hits = scanAppModules(output);
    copied = scanCopiedText(outDir, output);
  }, 90_000);

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    if (publicDir) fs.rmSync(publicDir, { recursive: true, force: true });
    if (assetRoot) fs.rmSync(assetRoot, { recursive: true, force: true });
    if (outsideDir) fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("flags a planted string constant in the app chunk", () => {
    const hit = hits.find((item) => item.excerpt.includes(phrase));
    expect(hit, formatBannedHits(hits)).toBeDefined();
    expect(hit?.file).toMatch(/\.js \(src\/lib\/format\.ts\)$/);
    expect(hit?.excerpt).toContain(phrase);
    expect(hit?.stem).toBe("airdrop");
  });

  it("flags airdrop shipped in the bundle", () => {
    const hit = hits.find((item) => item.stem === "airdrop" && item.excerpt.toLowerCase().includes(dropped));
    expect(hit, formatBannedHits(hits)).toBeDefined();
    expect(hit?.file).toMatch(/\.js \(src\/lib\/format\.ts\)$/);
    expect(formatBannedHits(hit ? [hit] : [])).toContain(dropped);
  });

  it("flags an inflected form shipped in the bundle", () => {
    const hit = hits.find((item) => item.match.toLowerCase() === inflection);
    expect(hit, formatBannedHits(hits)).toBeDefined();
    expect(hit?.stem).toBe("reward");
    expect(hit?.file).toMatch(/\.js \(src\/lib\/format\.ts\)$/);
    expect(hit?.excerpt.toLowerCase()).toContain(inflection);
  });

  it("flags punctuated labels in the built app module that the previous gate missed", () => {
    const app = appModules(output).find((mod) => normalize(mod.id).endsWith("/src/App.tsx"));
    expect(app).toBeDefined();
    const previous = legacyOneWordGate(app?.code ?? "", "App.tsx");
    expect(previous, formatBannedHits(previous)).toEqual([]);
    const planted = hits.filter((hit) => /\(src\/App\.tsx\)$/.test(hit.file));
    expect(planted.map((hit) => hit.stem).sort()).toEqual(["apy", "earn", "price", "reward"]);
    expect(planted.find((hit) => hit.stem === "price")?.excerpt).toBe(priceLabel);
    expect(planted.find((hit) => hit.stem === "reward")?.excerpt).toBe(rewardsLabel);
    expect(planted.find((hit) => hit.stem === "apy")?.excerpt).toBe(apyLabel);
    expect(planted.find((hit) => hit.stem === "earn")?.excerpt).toBe(earnLabel);
    expect(planted.every((hit) => /\.js \(src\/App\.tsx\)$/.test(hit.file))).toBe(true);
  });

  it("flags a JSON file copied from public into dist", () => {
    const copied = scanCopiedText(outDir, output).filter((hit) => hit.file === "notice.json");
    expect(copied, formatBannedHits(copied)).toHaveLength(1);
    expect(copied[0]?.stem).toBe("earn");
    expect(copied[0]?.file).toBe("notice.json");
    expect(fs.existsSync(path.join(outDir, "notice.json"))).toBe(true);
  });

  it("flags a text file copied from public into dist", () => {
    const copied = scanCopiedText(outDir, output).filter((hit) => hit.file === "notice.txt");
    expect(copied, formatBannedHits(copied)).toHaveLength(1);
    expect(copied[0]?.stem).toBe("trade");
    expect(copied[0]?.file).toBe("notice.txt");
    expect(fs.existsSync(path.join(outDir, "notice.txt"))).toBe(true);
  });

  it("flags a CSS content value in the built stylesheet", () => {
    const cssHits = scanCssContent(outDir);
    expect(cssHits.some((hit) => hit.stem === "profit" && hit.excerpt === profitable), formatBannedHits(cssHits)).toBe(true);
    expect(cssHits.some((hit) => hit.stem === "reward" && hit.excerpt === cssVar)).toBe(true);
    expect(cssHits.every((hit) => hit.file.endsWith(".css"))).toBe(true);
  });

  it("flags hyphenated labels planted in the built app module", () => {
    const planted = hits.filter((hit) => hit.file.includes("src/lib/format.ts"));
    expect(planted.some((hit) => hit.stem === "airdrop" && hit.excerpt.includes(airdropEligible))).toBe(true);
    expect(planted.some((hit) => hit.stem === "reward" && hit.excerpt.includes(rewardReady))).toBe(true);
    expect(planted.some((hit) => hit.stem === "airdrop" && hit.excerpt.includes(airDrop))).toBe(true);
    expect(planted.some((hit) => hit.stem === "presale" && hit.excerpt.includes(nbPreSale))).toBe(true);
  });

  it("flags a shared module outside src and outside node_modules", () => {
    const hit = hits.find((item) => item.file.includes("shared/planted-copy"));
    expect(hit, formatBannedHits(hits)).toBeDefined();
    expect(hit?.stem).toBe("listing");
    expect(isAppModuleId(sharedId)).toBe(true);
    expect(isVendorModuleId(sharedId)).toBe(false);
  });

  it("flags a webmanifest, an svg, and index.html copied into dist", () => {
    const manifest = copied.filter((hit) => hit.file === "site.webmanifest");
    const svg = copied.filter((hit) => hit.file === "mark.svg");
    const html = copied.filter((hit) => hit.file === "index.html");
    expect(manifest.map((hit) => hit.stem)).toEqual(["profit"]);
    expect(svg.map((hit) => hit.stem)).toEqual(["trade"]);
    expect(html.some((hit) => hit.stem === "invest")).toBe(true);
    expect(fs.existsSync(path.join(outDir, "site.webmanifest"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "mark.svg"))).toBe(true);
  });

  it("flags an external 302 target in _redirects", () => {
    const bad = copied.filter((hit) => hit.stem === "redirect");
    expect(bad, formatBannedHits(copied)).toHaveLength(1);
    expect(bad[0]?.match).toBe("https://example.invalid/out");
    expect(bad[0]?.file).toBe("_redirects");
  });

  it("flags every non-binary public file, a symlinked directory, emitted assets, and a worker", () => {
    const all = [...hits, ...copied];
    const expectCaught = (stem: string, filePart: string) => {
      const hit = all.find((item) => item.stem === stem && item.file.includes(filePart));
      expect(hit, formatBannedHits(all.filter((item) => item.file.includes(filePart)))).toBeDefined();
    };
    expectCaught("airdrop", "_headers");
    expectCaught("presale", "note.js");
    expectCaught("reward", "app.mjs");
    expectCaught("airdrop", "notice.csv");
    expectCaught("listing", "feed.rss");
    expectCaught("value", "page.xhtml");
    expectCaught("invest", "cal.ics");
    expectCaught("apy", "notes.yaml");
    expectCaught("earn", "LICENSE");
    expectCaught("profit", "linkdir/notes.txt");
    expectCaught("airdrop", "terms");
    expectCaught("earn", "small.txt");
    expectCaught("value", "logo.svg");
    expectCaught("trade", "data-uri");
    expectCaught("presale", "worker");
  });
});
