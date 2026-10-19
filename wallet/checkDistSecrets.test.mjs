import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  bundleShapeFindings,
  formatFinding,
  isKeyLikeRpc,
  scanDist,
  scanHexLiterals,
  secretMaterial,
} from "./checkDistSecrets.mjs";

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

function rules(findings) {
  return findings.map((finding) => finding.rule);
}

function rendered(findings) {
  return findings.map((finding) => formatFinding(finding)).join("\n");
}

test("passes a bundle that only mentions public VITE_ relayer names", () => {
  const dir = writeDist({
    "index.html": "<!doctype html>",
    "assets/app.js": 'throw new Error("VITE_RELAYER_URL is not set.");\nconst RELAYER_BASE_URL = "";\n',
  });
  assert.deepEqual(scanDist(dir, { knownRoots: [], env: {} }), []);
});

test("fails on RELAYER_PRIVATE_KEY and ADMIN_SECRET names without printing them", () => {
  const dir = writeDist({
    "assets/app.js": 'const leaked = { RELAYER_PRIVATE_KEY: "", ADMIN_SECRET: "" };\n',
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.deepEqual(rules(findings).sort(), ["admin-secret", "relayer-private-key"]);
  const text = rendered(findings);
  assert.match(text, /^assets\/app\.js:\d+ /m);
  assert.equal(text.includes("RELAYER_PRIVATE_KEY"), false);
  assert.equal(text.includes("ADMIN_SECRET"), false);
});

test("does not treat a longer identifier as a secret name", () => {
  const dir = writeDist({
    "assets/app.js": "const ADMIN_SECRETARY = 1; const VITE_RELAYER_URL = '';\n",
  });
  assert.deepEqual(scanDist(dir, { knownRoots: [], env: {} }), []);
});

test("fails on a standalone 64-hex value with or without 0x", () => {
  const bare = hex64();
  const prefixed = `0x${hex64()}`;
  const dir = writeDist({
    "assets/app.js": `const a = "${bare}";\nconst b = "${prefixed}";\n`,
  });
  const findings = scanDist(dir, { knownRoots: [] });
  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding) => finding.rule === "hex64"));
  const text = rendered(findings);
  assert.equal(text.includes(bare), false);
  assert.equal(text.includes(prefixed.slice(2)), false);
});

test("ignores a 64-hex slice inside a longer hex run and a repeated nibble", () => {
  const long = hex64() + hex64();
  const repeated = "b".repeat(64);
  const dir = writeDist({
    "assets/app.js": `const bytecode = "0x${long}";\nconst placeholder = "0x${repeated}";\n`,
  });
  assert.deepEqual(scanDist(dir, { knownRoots: [] }), []);
});

test("allows a 64-hex value that already exists in a known root", () => {
  const body = hex64();
  const root = tempDir();
  fs.writeFileSync(path.join(root, "public.js"), `export const PATH = "0x${body}";\n`);
  const dir = writeDist({ "assets/app.js": `const pathHash = "0x${body}";\n` });
  assert.deepEqual(scanDist(dir, { knownRoots: [root] }), []);
});

test("catches base64 and base64url forms of a secret-like env value", () => {
  const key = hex64();
  const admin = randomBytes(24).toString("hex");
  const keyEncoded = Buffer.from(key, "hex").toString("base64");
  const adminEncoded = Buffer.from(admin, "utf8").toString("base64url");
  const dir = writeDist({
    "assets/app.js": `const a = ${JSON.stringify(keyEncoded)};\nconst b = ${JSON.stringify(adminEncoded)};\n`,
  });
  const env = { RELAYER_PRIVATE_KEY: key, ADMIN_SECRET: admin };
  const findings = scanDist(dir, { knownRoots: [], env });
  assert.ok(rules(findings).includes("forbidden-encoding"));
  const text = rendered(findings);
  assert.equal(text.includes(key), false);
  assert.equal(text.includes(admin), false);
  assert.equal(text.includes(keyEncoded), false);
  assert.equal(text.includes(adminEncoded), false);
});

test("catches a secret-like value split across two files", () => {
  const key = hex64();
  const mid = Math.floor(key.length / 2);
  const dir = writeDist({
    "assets/a.js": `const left = ${JSON.stringify(key.slice(0, mid))};\n`,
    "assets/b.js": `const right = ${JSON.stringify(key.slice(mid))};\n`,
  });
  const findings = scanDist(dir, {
    knownRoots: [],
    env: { RELAYER_KEY: key },
  });
  assert.deepEqual(rules(findings), ["forbidden-split"]);
  const text = rendered(findings);
  assert.equal(text.includes(key), false);
  assert.equal(text.includes(key.slice(0, mid)), false);
  assert.equal(text.includes(key.slice(mid)), false);
});

test("compares every secret-like env value, not a fixed pair of names", () => {
  const userKey = hex64();
  const dir = writeDist({
    "assets/app.js": `self.value = ${JSON.stringify(userKey.toUpperCase())};\n`,
  });
  const findings = scanDist(dir, { knownRoots: [], env: { USER_PRIVATE_KEY: `0x${userKey}` } });
  assert.ok(rules(findings).includes("forbidden-value"));
  assert.equal(rendered(findings).includes(userKey), false);
  const material = secretMaterial({ USER_PRIVATE_KEY: userKey, RELAYER_BASE_URL: "https://example.invalid" });
  assert.equal(material.some((item) => item.name === "USER_PRIVATE_KEY"), true);
  assert.equal(material.some((item) => item.name === "RELAYER_BASE_URL"), false);
});

test("flags a provider URL with a key-like path and ignores a public endpoint", () => {
  const key = randomBytes(16).toString("hex");
  const keyed = `https://rpc.example.invalid/v2/${key}`;
  const pub = "https://sepolia.base.org";
  assert.equal(isKeyLikeRpc(keyed), true);
  assert.equal(isKeyLikeRpc(pub), false);
  const dir = writeDist({
    "assets/app.js": `const a = ${JSON.stringify(keyed)};\nconst b = ${JSON.stringify(pub)};\n`,
  });
  const findings = scanDist(dir, { knownRoots: [], env: { RPC_URL: keyed } });
  assert.ok(rules(findings).includes("rpc-url"));
  assert.ok(rules(findings).includes("forbidden-value"));
  const text = rendered(findings);
  assert.equal(text.includes(key), false);
  assert.equal(text.includes(keyed), false);
});

test("source maps do not fail on ordinary constant names", () => {
  const map = {
    version: 3,
    sources: ["src/lib/fixture.ts", "src/lib/relayerError.ts", "src/config.ts"],
    sourcesContent: [
      "export const RELAYER_DRY_PATH_HASH = 'bb';\nexport const RELAYER_DRY_AMOUNTS = {};\n",
      "export const RELAYER_FETCH_TIMEOUT_MS = 25000;\n",
      "/* Unprefixed RELAYER_BASE_URL is not read. */\n",
    ],
    mappings: "",
  };
  const dir = writeDist({
    "assets/app.js": "console.log('ok');\n",
    "assets/app.js.map": JSON.stringify(map),
  });
  const findings = scanDist(dir, {
    knownRoots: [],
    env: {
      RELAYER_BASE_URL: "https://example.invalid",
      RELAYER_KEY: hex64(),
      RELAYER_PRIVATE_KEY: hex64(),
      ADMIN_SECRET: hex64(),
    },
  });
  assert.deepEqual(findings, []);
});

test("fails when a 64-hex literal is committed under client source", () => {
  const body = hex64();
  const root = tempDir();
  const file = path.join(root, "plant.ts");
  fs.writeFileSync(file, `export const SEED = "0x${body}";\nexport const OK = "${"a".repeat(64)}";\n`);
  const findings = scanHexLiterals([root]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "hex64-literal");
  assert.equal(findings[0].line, 1);
  assert.equal(formatFinding(findings[0]).includes(body), false);
});

test("exempts only the public gitleaks checksum assignment", () => {
  const extra = hex64();
  const root = tempDir();
  const file = path.join(root, ".github", "workflows", "gitleaks.yml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const checksum = fs
    .readFileSync(path.resolve(here, "../.github/workflows/gitleaks.yml"), "utf8")
    .split("\n")
    .find((line) => line.includes("GITLEAKS_SHA256="));
  assert.ok(checksum);
  fs.writeFileSync(file, `${checksum}\nOTHER=${extra}\n`);
  const findings = scanHexLiterals([file]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
  assert.equal(findings[0].rule, "hex64-literal");
  const real = scanHexLiterals([
    path.join(here, "src"),
    path.resolve(here, "../.github/workflows/gitleaks.yml"),
  ]);
  assert.deepEqual(real, []);
});

test("fails on an empty or missing dist", () => {
  const missing = path.join(tempDir(), "dist");
  assert.equal(bundleShapeFindings(missing)[0].rule, "missing-dist");
  const empty = tempDir();
  assert.equal(bundleShapeFindings(empty)[0].rule, "empty-dist");
  fs.writeFileSync(path.join(empty, "index.html"), "<!doctype html>");
  assert.equal(bundleShapeFindings(empty)[0].rule, "empty-dist");
  fs.writeFileSync(path.join(empty, "app.js"), "console.log(1)\n");
  assert.deepEqual(bundleShapeFindings(empty), []);
});

test("cli prints file:line and rule only", () => {
  const key = hex64();
  const admin = randomBytes(16).toString("hex");
  const encoded = Buffer.from(key, "hex").toString("base64");
  const dir = writeDist({
    "index.html": "<!doctype html>\n",
    "assets/app.js": `self.RELAYER_PRIVATE_KEY=${JSON.stringify(key)};self.ADMIN_SECRET=${JSON.stringify(admin)};self.enc=${JSON.stringify(encoded)};\n`,
  });
  const script = path.join(here, "checkDistSecrets.mjs");
  const result = spawnSync(process.execPath, [script, dir, "--root", tempDir()], {
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
  assert.match(output, /assets\/app\.js:\d+ relayer-private-key/);
  assert.match(output, /assets\/app\.js:\d+ admin-secret/);
  assert.match(output, /assets\/app\.js:\d+ forbidden-value/);
  assert.match(output, /assets\/app\.js:\d+ forbidden-encoding/);
  for (const line of output.split("\n")) {
    if (!line.includes(":")) continue;
    if (line.startsWith("bundle secret check")) continue;
    assert.match(line, /^[^:\s][^:\n]*:\d+ [a-z0-9-]+$/);
  }
  assert.equal(output.includes(key), false);
  assert.equal(output.includes(admin), false);
  assert.equal(output.includes(encoded), false);
});

test("client source reads import.meta.env only as static public fields", () => {
  const roots = [path.join(here, "src"), path.resolve(here, "../shared")];
  const bad = [];
  const allowed = /import\.meta\.env\.(?:VITE_[A-Z0-9_]+|MODE|DEV|PROD|BASE_URL|SSR)\b/g;
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|jsx)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8").replace(allowed, "");
          if (/import\.meta\.env/.test(text)) bad.push(path.relative(here, full));
        }
      }
    }
  }
  assert.deepEqual(bad, []);
  const vite = fs.readFileSync(path.join(here, "vite.config.ts"), "utf8");
  assert.match(vite, /envPrefix:\s*\[\s*"VITE_"\s*\]/);
  assert.equal(vite.includes('"RELAYER_"'), false);
});
