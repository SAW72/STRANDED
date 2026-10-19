import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { publishPointsShell } from "./spaFallback";
import { pointsShellPlugin } from "./vite.config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("publishPointsShell", () => {
  it("copies the SPA shell to points/index.html", () => {
    const dist = tempDir("stranded-dist-");
    const shell = '<div id="root"></div>\n<script type="module" src="/assets/index.js"></script>\n';
    fs.writeFileSync(path.join(dist, "index.html"), shell);
    publishPointsShell(dist);
    expect(fs.readFileSync(path.join(dist, "points", "index.html"), "utf8")).toBe(shell);
  });

  it("throws when the SPA shell is missing", () => {
    const dist = tempDir("stranded-dist-");
    expect(() => publishPointsShell(dist)).toThrow(
      `SPA shell is missing at ${path.join(dist, "index.html")}`,
    );
  });

  it("publishes into path.resolve(root, build.outDir)", () => {
    const root = tempDir("stranded-root-");
    const shell = "<html></html>\n";
    const dest = path.resolve(root, "custom-out");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "index.html"), shell);
    const plugin = pointsShellPlugin();
    if (typeof plugin.configResolved !== "function" || typeof plugin.closeBundle !== "function") {
      throw new Error("points shell plugin is missing its build hooks");
    }
    plugin.configResolved.call({} as never, { root, build: { outDir: "custom-out" } } as never);
    plugin.closeBundle.call({} as never);
    expect(fs.readFileSync(path.join(dest, "points", "index.html"), "utf8")).toBe(shell);
  });
});

describe("host SPA fallback", () => {
  it("rewrites /points to index.html in render.yaml and _redirects", () => {
    const yaml = fs.readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
    expect(yaml).toMatch(/source: \/points\n\s+destination: \/index\.html/);
    expect(yaml).toMatch(/source: \/\*\n\s+destination: \/index\.html/);
    const redirects = fs.readFileSync(path.join(repoRoot, "wallet/public/_redirects"), "utf8");
    expect(redirects).toMatch(/^\/points\s+\/index\.html\s+200$/m);
    expect(redirects).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
  });
});
