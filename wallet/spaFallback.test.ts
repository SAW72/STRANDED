import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publishPointsShell } from "./spaFallback";
import { pointsShellPlugin } from "./vite.config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("publishPointsShell", () => {
  it("copies the SPA shell to points/index.html", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-dist-"));
    const shell = '<div id="root"></div>\n<script type="module" src="/assets/index.js"></script>\n';
    fs.writeFileSync(path.join(dist, "index.html"), shell);
    publishPointsShell(dist);
    expect(fs.readFileSync(path.join(dist, "points", "index.html"), "utf8")).toBe(shell);
  });

  it("throws when the SPA shell is missing", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-dist-"));
    expect(() => publishPointsShell(dist)).toThrow(
      `SPA shell is missing at ${path.join(dist, "index.html")}`,
    );
  });

  it("publishes into Vite's resolved build.outDir", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-outdir-"));
    const shell = "<html></html>\n";
    fs.writeFileSync(path.join(dist, "index.html"), shell);
    const plugin = pointsShellPlugin();
    if (typeof plugin.configResolved !== "function" || typeof plugin.closeBundle !== "function") {
      throw new Error("points shell plugin is missing its build hooks");
    }
    plugin.configResolved.call({} as never, { build: { outDir: dist } } as never);
    plugin.closeBundle.call({} as never);
    expect(fs.readFileSync(path.join(dist, "points", "index.html"), "utf8")).toBe(shell);
    expect(dist.endsWith(`${path.sep}dist`)).toBe(false);
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
