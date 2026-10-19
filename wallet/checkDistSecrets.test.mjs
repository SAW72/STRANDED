import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { scanDist } from "./checkDistSecrets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function hex64() {
  return randomBytes(32).toString("hex");
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bundle-check-"));
}

function writeDist(files) {
  const dir = tempDir();
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

test("passes a bundle that only mentions VITE_ relayer names", () => {
  const dir = writeDist({
    "assets/app.js": 'throw new Error("VITE_RELAYER_URL is not set.");\n',
  });
  assert.deepEqual(scanDist(dir, { knownRoots: [] }), []);
});

test("fails on RELAYER_PRIVATE_KEY, ADMIN_SECRET, and other RELAYER_ env keys", () => {
  const dir = writeDist({
    "assets/app.js":
      'const leaked = { RELAYER_PRIVATE_KEY: "", ADMIN_SECRET: "", RELAYER_BASE_URL: "" };\n',
  });
  const kinds = scanDist(dir, { knownRoots: [] }).map((finding) => `${finding.kind}:${finding.detail}`);
  assert.ok(kinds.includes("relayer-private-key:RELAYER_PRIVATE_KEY"));
  assert.ok(kinds.includes("admin-secret:ADMIN_SECRET"));
  assert.ok(kinds.includes("relayer-env-key:RELAYER_BASE_URL"));
});

test("does not treat a longer identifier as the admin or relayer env name", () => {
  const dir = writeDist({
    "assets/app.js": "const ADMIN_SECRETARY = 1; const VITE_RELAYER_URL = '';\n",
  });
  assert.deepEqual(scanDist(dir, { knownRoots: [] }), []);
});

test("fails on a standalone 64-hex token with or without 0x", () => {
  const bare = hex64();
  const prefixed = `0x${hex64()}`;
  const dir = writeDist({
    "assets/app.js": `const a = "${bare}"; const b = "${prefixed}";\n`,
  });
  const findings = scanDist(dir, { knownRoots: [] }).filter((finding) => finding.kind === "hex64");
  assert.equal(findings.length, 2);
  for (const finding of findings) {
    assert.equal(finding.detail.includes(bare), false);
    assert.equal(finding.detail.includes(prefixed.slice(2)), false);
  }
});

test("ignores a 64-hex slice inside a longer hex run", () => {
  const long = hex64() + hex64();
  const dir = writeDist({ "assets/app.js": `const bytecode = "0x${long}";\n` });
  assert.deepEqual(scanDist(dir, { knownRoots: [] }), []);
});

test("allows a 64-hex token that already exists in a known root", () => {
  const body = hex64();
  const root = tempDir();
  fs.writeFileSync(path.join(root, "public.js"), `export const PATH = "0x${body}";\n`);
  const dir = writeDist({ "assets/app.js": `const pathHash = "0x${body}";\n` });
  assert.deepEqual(scanDist(dir, { knownRoots: [root] }), []);
});

test("fails when a forbidden environment value is inlined", () => {
  const key = hex64();
  const admin = randomBytes(16).toString("hex");
  const dir = writeDist({
    "assets/app.js": `const blob = ${JSON.stringify({ key, admin })};\n`,
  });
  const findings = scanDist(dir, {
    knownBodies: new Set([key]),
    forbiddenValues: [
      { name: "RELAYER_PRIVATE_KEY", value: key },
      { name: "ADMIN_SECRET", value: admin },
    ],
  });
  const details = findings.map((finding) => `${finding.kind}:${finding.detail}`);
  assert.ok(details.includes("forbidden-value:RELAYER_PRIVATE_KEY"));
  assert.ok(details.includes("forbidden-value:ADMIN_SECRET"));
  assert.equal(details.some((detail) => detail.startsWith("hex64:")), false);
});

test("cli rejects a planted canary without printing it", () => {
  const key = hex64();
  const admin = randomBytes(16).toString("hex");
  const dir = writeDist({
    "assets/app.js": `self.RELAYER_PRIVATE_KEY=${JSON.stringify(key)};self.ADMIN_SECRET=${JSON.stringify(admin)};\n`,
  });
  const emptyRoot = tempDir();
  const script = path.join(here, "checkDistSecrets.mjs");
  const result = spawnSync(process.execPath, [script, dir, "--root", emptyRoot], {
    cwd: here,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      RELAYER_PRIVATE_KEY: key,
      ADMIN_SECRET: admin,
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(output.includes(key), false);
  assert.equal(output.includes(admin), false);
  assert.match(output, /relayer-private-key/);
  assert.match(output, /admin-secret/);
  assert.match(output, /forbidden-value RELAYER_PRIVATE_KEY/);
  assert.match(output, /forbidden-value ADMIN_SECRET/);
});

test("wallet source reads import.meta.env statically and only exposes VITE_", () => {
  const config = fs.readFileSync(path.join(here, "src/config.ts"), "utf8");
  const demo = fs.readFileSync(path.join(here, "src/lib/demoToken.ts"), "utf8");
  const vite = fs.readFileSync(path.join(here, "vite.config.ts"), "utf8");
  assert.equal(/import\.meta\.env\s*\[/.test(config), false);
  assert.equal(/import\.meta\.env\s*\[/.test(demo), false);
  assert.match(config, /import\.meta\.env\.VITE_RELAYER_URL\b/);
  assert.match(config, /import\.meta\.env\.VITE_RELAYER_BASE_URL\b/);
  assert.equal(config.includes("import.meta.env.RELAYER_BASE_URL"), false);
  assert.match(demo, /import\.meta\.env\.VITE_TOKEN_ADDRESS_ARB_SEPOLIA\b/);
  assert.match(vite, /envPrefix:\s*\[\s*"VITE_"\s*\]/);
  assert.equal(vite.includes('"RELAYER_"'), false);
});
