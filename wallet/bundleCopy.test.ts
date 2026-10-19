import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "vite";

const walletRoot = path.dirname(fileURLToPath(import.meta.url));

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

function bannedWordsIn(text: string): string[] {
  const stripped = text.replace(/\bno value\b/gi, " ").replace(/\bno cash value\b/gi, " ");
  return BANNED.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(stripped));
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

function walk(dir: string, accept: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, accept));
    else if (accept(entry.name)) found.push(full);
  }
  return found;
}

describe("banned words beyond source strings", () => {
  it("scans JSX text and the built bundle", async () => {
    const sources = walk(path.join(walletRoot, "src"), (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"));
    const jsx = sources.flatMap((file) => jsxText(fs.readFileSync(file, "utf8")));
    expect(jsx.some((line) => line.includes("What happens to your tokens"))).toBe(true);
    const jsxHits = jsx.flatMap((text) => bannedWordsIn(text).map((word) => `${word}: ${text}`));
    expect(jsxHits).toEqual([]);
    for (const line of jsx) expect(line).not.toMatch(/\bearn/i);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-bundle-"));
    await build({
      root: walletRoot,
      configFile: path.join(walletRoot, "vite.config.ts"),
      build: { outDir, emptyOutDir: true },
      logLevel: "silent",
    });
    const bundle = walk(outDir, (name) => name.endsWith(".js"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    expect(bundle).toContain("What happens to your tokens");
    expect(bundle).not.toMatch(/\bearn/i);
    const shipped = jsx.filter((line) => line.length > 12 && bundle.includes(line));
    expect(shipped.length).toBeGreaterThan(0);
    const shippedHits = shipped.flatMap((text) => bannedWordsIn(text).map((word) => `${word}: ${text}`));
    expect(shippedHits).toEqual([]);
  }, 60_000);
});
