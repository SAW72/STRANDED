import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";
import {
  bannedWordsIn,
  formatBannedHits,
  type BannedHit,
  hitsInAppCode,
} from "./src/lib/bannedWords";

const walletRoot = path.dirname(fileURLToPath(import.meta.url));

function walk(dir: string, accept: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, accept));
    else if (accept(entry.name)) found.push(full);
  }
  return found;
}

function appChunkFiles(outDir: string): string[] {
  return walk(outDir, (name) => name.endsWith(".js") && !name.includes("vendor"));
}

function scanAppChunks(outDir: string): BannedHit[] {
  return appChunkFiles(outDir).flatMap((file) =>
    hitsInAppCode(fs.readFileSync(file, "utf8"), path.basename(file)),
  );
}

async function buildWallet(outDir: string, plugins: Plugin[] = []) {
  await build({
    root: walletRoot,
    configFile: path.join(walletRoot, "vite.config.ts"),
    plugins,
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) return "vendor";
          },
        },
      },
    },
    logLevel: "silent",
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

describe("banned-word scanner", () => {
  const phrase = ["Claim your ", "air", "drop", " today"].join("");
  const dropped = ["air", "drop"].join("");
  const inflection = ["re", "wards"].join("");

  it("flags a string constant and prints the text and the file", () => {
    const hits = hitsInAppCode(`export const label = ${JSON.stringify(phrase)};`, "format.ts");
    const message = formatBannedHits(hits);
    expect(message).toContain("format.ts");
    expect(message).toContain(phrase);
    expect(hits.map((hit) => hit.stem)).toContain("airdrop");
  });

  it("flags inflections of every stem", () => {
    expect(bannedWordsIn(inflection)).toEqual(["reward"]);
    expect(bannedWordsIn(["earn", "ed"].join(""))).toEqual(["earn"]);
    expect(bannedWordsIn(["earn", "ing"].join(""))).toEqual(["earn"]);
    expect(bannedWordsIn(["earn", "s"].join(""))).toEqual(["earn"]);
    expect(bannedWordsIn(["air", "drop", "s"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["air", "drop", "ped"].join(""))).toEqual(["airdrop"]);
    expect(bannedWordsIn(["trad", "ing"].join(""))).toEqual(["trade"]);
    expect(bannedWordsIn(["pric", "ed"].join(""))).toEqual(["price"]);
    expect(bannedWordsIn(["valu", "ing"].join(""))).toEqual(["value"]);
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
});

describe("built app chunks", () => {
  it("runs the full banned list on app chunks and leaves no temp build", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-bundle-"));
    try {
      await buildWallet(outDir);
      const vendor = walk(outDir, (name) => name.endsWith(".js") && name.includes("vendor"));
      expect(vendor.length).toBeGreaterThan(0);
      const appFiles = appChunkFiles(outDir);
      expect(appFiles.length).toBeGreaterThan(0);
      const app = appFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
      expect(app).toContain("What happens to your tokens");
      const hits = scanAppChunks(outDir);
      expect(hits, formatBannedHits(hits)).toEqual([]);
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
  }, 60_000);
});

describe("planted bundle copy", () => {
  const phrase = ["Claim your ", "air", "drop", " today"].join("");
  const dropped = ["air", "drop"].join("");
  const inflection = ["re", "wards"].join("");
  let outDir = "";
  let hits: BannedHit[] = [];

  function plantPlugin(): Plugin {
    return {
      name: "plant-banned-copy",
      enforce: "pre",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/lib/format.ts")) return null;
        const extra = [
          "Object.assign(globalThis, {",
          `__plantedConstant: ${JSON.stringify(phrase)},`,
          `__plantedInflection: ${JSON.stringify(inflection)},`,
          '__plantedSplit: "air" + "drop"',
          "});",
        ].join("\n");
        return { code: `${code}\n${extra}\n`, map: null };
      },
    };
  }

  beforeAll(async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-plant-"));
    await buildWallet(outDir, [plantPlugin()]);
    hits = scanAppChunks(outDir);
  }, 60_000);

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("flags a planted string constant in the app chunk", () => {
    const hit = hits.find((item) => item.excerpt.includes(phrase));
    expect(hit, formatBannedHits(hits)).toBeDefined();
    expect(hit?.file).toMatch(/\.js$/);
    expect(hit?.excerpt).toContain(phrase);
    expect(hit?.stem).toBe("airdrop");
  });

  it("flags airdrop shipped in the bundle", () => {
    const hit = hits.find((item) => item.stem === "airdrop" && item.excerpt.toLowerCase().includes(dropped));
    expect(hit, formatBannedHits(hits)).toBeDefined();
    expect(hit?.file).toMatch(/\.js$/);
    expect(formatBannedHits(hit ? [hit] : [])).toContain(dropped);
  });

  it("flags an inflected form shipped in the bundle", () => {
    const hit = hits.find((item) => item.match.toLowerCase() === inflection);
    expect(hit, formatBannedHits(hits)).toBeDefined();
    expect(hit?.stem).toBe("reward");
    expect(hit?.file).toMatch(/\.js$/);
    expect(hit?.excerpt.toLowerCase()).toContain(inflection);
  });
});
