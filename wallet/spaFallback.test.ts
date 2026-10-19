import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publishPointsShell } from "./spaFallback";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("publishPointsShell", () => {
  it("copies the SPA shell to points/index.html", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "stranded-dist-"));
    const shell = '<div id="root"></div>\n<script type="module" src="/assets/index.js"></script>\n';
    fs.writeFileSync(path.join(dist, "index.html"), shell);
    publishPointsShell(dist);
    expect(fs.readFileSync(path.join(dist, "points", "index.html"), "utf8")).toBe(shell);
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
