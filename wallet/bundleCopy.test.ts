import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutputChunk, RollupOutput } from "rollup";
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
  type BannedHit,
} from "./src/lib/bannedWords";

const walletRoot = path.dirname(fileURLToPath(import.meta.url));
const walletSrc = `${walletRoot.replaceAll("\\", "/")}/src/`;

function normalize(id: string): string {
  return id.replaceAll("\\", "/");
}

function walk(dir: string, accept: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, accept));
    else if (accept(entry.name)) found.push(full);
  }
  return found;
}

function isAppModuleId(id: string): boolean {
  const norm = normalize(id);
  if (norm.includes("/node_modules/") || norm.includes("\0")) return false;
  return norm.startsWith(walletSrc);
}

function isVendorModuleId(id: string): boolean {
  return normalize(id).includes("/node_modules/");
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

function scanAppModules(output: RollupOutput["output"]): BannedHit[] {
  return appModules(output).flatMap((mod) => {
    const rel = path.relative(walletRoot, mod.id).split(path.sep).join("/");
    return hitsInAppCode(mod.code, `${mod.chunkFile} (${rel})`);
  });
}

function isPublicText(name: string): boolean {
  if (name === "_redirects") return true;
  const ext = path.extname(name).toLowerCase();
  return ext === ".json" || ext === ".txt" || ext === ".text";
}

function scanCopiedText(outDir: string, publicDir: string): BannedHit[] {
  if (!fs.existsSync(publicDir)) return [];
  const hits: BannedHit[] = [];
  for (const file of walk(publicDir, isPublicText)) {
    const rel = path.relative(publicDir, file).split(path.sep).join("/");
    const shipped = path.join(outDir, rel);
    hits.push(...bannedHitsInText(fs.readFileSync(shipped, "utf8"), rel));
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
  const result = await build({
    root: walletRoot,
    configFile: path.join(walletRoot, "vite.config.ts"),
    plugins: extra.plugins,
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
  return result;
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
    expect(bannedWordsIn("learn yearn earnest unearned valuation tradeoff")).toEqual([]);
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
      const copied = scanCopiedText(outDir, publicDir);
      expect(walk(publicDir, isPublicText).length).toBeGreaterThan(0);
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
  let outDir = "";
  let publicDir = "";
  let hits: BannedHit[] = [];
  let output: RollupOutput["output"] = [];

  function plantPlugin(): Plugin {
    return {
      name: "plant-banned-copy",
      enforce: "pre",
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
          return { code: `${code.replace(anchor, `${anchor}${jsx}`)}\n${extra}\n`, map: null };
        }
        if (norm.endsWith("/src/lib/format.ts")) {
          const extra = [
            "Object.assign(globalThis, {",
            `__plantedConstant: ${JSON.stringify(phrase)},`,
            `__plantedInflection: ${JSON.stringify(inflection)},`,
            '__plantedSplit: "air" + "drop"',
            "});",
          ].join("\n");
          return { code: `${code}\n${extra}\n`, map: null };
        }
        if (norm.endsWith("/src/index.css")) {
          return { code: `${code}\n.plant{content:${JSON.stringify(profitable)};}\n`, map: null };
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
    const built = await buildWallet(outDir, { plugins: [plantPlugin()], publicDir });
    output = built.output;
    hits = scanAppModules(output);
  }, 90_000);

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    if (publicDir) fs.rmSync(publicDir, { recursive: true, force: true });
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
    const planted = hits.filter((hit) => hit.file.includes("src/App.tsx"));
    expect(planted.map((hit) => hit.stem).sort()).toEqual(["apy", "earn", "price", "reward"]);
    expect(planted.find((hit) => hit.stem === "price")?.excerpt).toBe(priceLabel);
    expect(planted.find((hit) => hit.stem === "reward")?.excerpt).toBe(rewardsLabel);
    expect(planted.find((hit) => hit.stem === "apy")?.excerpt).toBe(apyLabel);
    expect(planted.find((hit) => hit.stem === "earn")?.excerpt).toBe(earnLabel);
    expect(planted.every((hit) => /\.js \(src\/App\.tsx\)$/.test(hit.file))).toBe(true);
  });

  it("flags a JSON file copied from public into dist", () => {
    const copied = scanCopiedText(outDir, publicDir).filter((hit) => hit.file === "notice.json");
    expect(copied, formatBannedHits(copied)).toHaveLength(1);
    expect(copied[0]?.stem).toBe("earn");
    expect(copied[0]?.file).toBe("notice.json");
    expect(fs.existsSync(path.join(outDir, "notice.json"))).toBe(true);
  });

  it("flags a text file copied from public into dist", () => {
    const copied = scanCopiedText(outDir, publicDir).filter((hit) => hit.file === "notice.txt");
    expect(copied, formatBannedHits(copied)).toHaveLength(1);
    expect(copied[0]?.stem).toBe("trade");
    expect(copied[0]?.file).toBe("notice.txt");
    expect(fs.existsSync(path.join(outDir, "notice.txt"))).toBe(true);
  });

  it("flags a CSS content value in the built stylesheet", () => {
    const cssHits = scanCssContent(outDir);
    expect(cssHits, formatBannedHits(cssHits)).toHaveLength(1);
    expect(cssHits[0]?.stem).toBe("profit");
    expect(cssHits[0]?.file).toMatch(/\.css$/);
    expect(cssHits[0]?.excerpt).toBe(profitable);
  });
});
