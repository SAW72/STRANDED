import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  bundleShapeFindings,
  formatFinding,
  isKeyLikeRpc,
  isSecretLikeName,
  parseAllowlist,
  scanDist,
  scanHexLiterals,
  scanHexText,
  secretMaterial,
} from "./checkDistSecrets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function hex64() {
  return randomBytes(32).toString("hex");
}

const tempDirs = new Set();

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-check-"));
  tempDirs.add(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  const remain = [...tempDirs].filter((dir) => fs.existsSync(dir));
  assert.equal(remain.length, 0);
});

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
    "assets/app.js": 'throw new Error("VITE_RELAYER_URL is not set.");\n',
  });
  assert.deepEqual(scanDist(dir, { knownRoots: [], env: {} }), []);
});

test("fails on RELAYER_PRIVATE_KEY and ADMIN_SECRET names without printing them", () => {
  const dir = writeDist({
    "assets/app.js": 'const leaked = { RELAYER_PRIVATE_KEY: "", ADMIN_SECRET: "" };\n',
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.deepEqual(rules(findings).sort(), ["admin-secret", "relayer-env-key", "relayer-private-key"]);
  const text = rendered(findings);
  assert.match(text, /^assets\/app\.js:\d+:\d+ /m);
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
  const pub = "https://public.example.invalid/rpc";
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

test("exempts only the checksum assignment in the workflow file", () => {
  const extra = hex64();
  const realFile = path.resolve(here, "../.github/workflows/gitleaks.yml");
  const assignment = fs
    .readFileSync(realFile, "utf8")
    .split("\n")
    .find((line) => line.includes("GITLEAKS_SHA256="));
  assert.ok(assignment);
  const value = assignment.slice(assignment.indexOf("=") + 1).trim();
  const commented = scanHexText(realFile, `${assignment} # ${extra}\n`);
  assert.equal(commented.length, 1);
  assert.equal(commented[0].rule, "hex64-literal");
  assert.equal(commented[0].line, 1);
  assert.equal(formatFinding(commented[0]).includes(extra), false);
  assert.equal(formatFinding(commented[0]).includes(value), false);
  const repeated = scanHexText(realFile, `${assignment} # ${value}\n`);
  assert.equal(repeated.length, 1);
  assert.equal(formatFinding(repeated[0]).includes(value), false);
  const otherFile = path.join(tempDir(), ".github", "workflows", "gitleaks.yml");
  fs.mkdirSync(path.dirname(otherFile), { recursive: true });
  fs.writeFileSync(otherFile, `${assignment}\n`);
  const copied = scanHexLiterals([otherFile]);
  assert.equal(copied.length, 1);
  assert.equal(copied[0].line, 1);
  assert.equal(formatFinding(copied[0]).includes(value), false);
  const real = scanHexLiterals([
    path.join(here, "src"),
    path.resolve(here, "../shared"),
    realFile,
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
  assert.match(output, /assets\/app\.js:\d+:\d+ relayer-private-key/);
  assert.match(output, /assets\/app\.js:\d+:\d+ admin-secret/);
  assert.match(output, /assets\/app\.js:\d+:\d+ forbidden-value/);
  assert.match(output, /assets\/app\.js:\d+:\d+ forbidden-encoding/);
  for (const line of output.split("\n")) {
    if (!line.includes(":")) continue;
    if (line.startsWith("bundle secret check")) continue;
    assert.match(line, /^[^:\s][^:\n]*:\d+:\d+ [a-z0-9-]+$/);
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

test("treats mnemonic, seed, phrase, and an embedded name fragment as secret", () => {
  assert.equal(isSecretLikeName("VITE_MNEMONIC"), true);
  assert.equal(isSecretLikeName("WALLET_SEED"), true);
  assert.equal(isSecretLikeName("BACKUP_PHRASE"), true);
  assert.equal(isSecretLikeName("FOO_TOKEN_V2"), true);
  const seed = randomBytes(24).toString("hex");
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(seed)}\n` });
  const findings = scanDist(dir, {
    knownRoots: [],
    env: { VITE_MNEMONIC: seed, WALLET_SEED: seed },
  });
  assert.ok(rules(findings).includes("forbidden-value"));
  assert.equal(rendered(findings).includes(seed), false);
});

test("flags any RELAYER_ name in built JS and not in a source map", () => {
  const dir = writeDist({
    "assets/app.js": "const RELAYER_FETCH_TIMEOUT_MS = 1;\n",
    "assets/app.js.map": '{"sourcesContent":["export const RELAYER_DRY_PATH_HASH = 1;"]}',
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.deepEqual(rules(findings), ["relayer-env-key"]);
  assert.equal(findings[0].column, 7);
  assert.equal(formatFinding(findings[0]), "assets/app.js:1:7 relayer-env-key");
  assert.equal(formatFinding(findings[0]).includes("RELAYER_FETCH_TIMEOUT_MS"), false);
});

test("catches an uneven split and a three-piece split", () => {
  const key = hex64();
  const uneven = writeDist({
    "assets/app.js": JSON.stringify(`${key.slice(0, 10)}:${key.slice(10)}`),
  });
  const unevenHits = scanDist(uneven, { knownRoots: [], env: { RELAYER_KEY: key } });
  assert.ok(rules(unevenHits).includes("forbidden-split"));
  assert.equal(rendered(unevenHits).includes(key), false);
  assert.equal(rendered(unevenHits).includes(key.slice(10, 26)), false);
  const parts = [key.slice(0, 20), key.slice(20, 40), key.slice(40)];
  const split = writeDist({
    "assets/a.js": JSON.stringify(parts[0]),
    "assets/b.js": JSON.stringify(parts[1]),
    "assets/c.js": JSON.stringify(parts[2]),
  });
  const splitHits = scanDist(split, { knownRoots: [], env: { WALLET_SEED: key } });
  assert.ok(rules(splitHits).includes("forbidden-split"));
  const text = rendered(splitHits);
  assert.equal(text.includes(key), false);
  for (const part of parts) assert.equal(text.includes(part), false);
});

test("flags bare path keys, query keys, wss, and userinfo", () => {
  const pathKey = randomBytes(16).toString("hex");
  const quick = `https://billowing-name.example.invalid/${pathKey}`;
  const chain = `https://node.example.invalid/${pathKey}`;
  const block = `https://go.example.invalid/${pathKey}`;
  const dkeyValue = ["Ahjs7k", "2mN4pQ", "8rSt"].join("");
  const queryValue = ["abcdef", "ghijklm"].join("");
  const dkey = `https://lb.example.invalid/base?dkey=${dkeyValue}`;
  const query = `wss://rpc.example.test/ws?token=${queryValue}`;
  const user = "https://demo:s3cret-value@rpc.example.invalid/rpc";
  const docs = "https://docs.example.invalid/v1/getting-started";
  const longerDocs = "https://docs.example.invalid/v1/getting-started-guide";
  assert.equal(isKeyLikeRpc(quick), true);
  assert.equal(isKeyLikeRpc(chain), true);
  assert.equal(isKeyLikeRpc(block), true);
  assert.equal(isKeyLikeRpc(dkey), true);
  assert.equal(isKeyLikeRpc(query), true);
  assert.equal(isKeyLikeRpc(user), true);
  assert.equal(isKeyLikeRpc(docs), false);
  assert.equal(isKeyLikeRpc(longerDocs), false);
  assert.equal(isKeyLikeRpc("wss://public.example.invalid/ws"), false);
  const dir = writeDist({
    "assets/app.js": [quick, dkey, query, user, docs].map((item) => JSON.stringify(item)).join("\n"),
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(findings.filter((finding) => finding.rule === "rpc-url").length, 4);
  const text = rendered(findings);
  assert.equal(text.includes(pathKey), false);
  assert.equal(text.includes("s3cret-value"), false);
  assert.equal(text.includes("Ahjs7k2mN4pQ8rSt"), false);
  assert.equal(text.includes("abcdefghijklm"), false);
});

test("compares every rpc url env value", () => {
  const pub = "https://public.example.invalid/rpc";
  assert.equal(isKeyLikeRpc(pub), false);
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(pub)}\n` });
  const findings = scanDist(dir, { knownRoots: [], env: { BASE_RPC_URL: pub } });
  assert.ok(rules(findings).includes("forbidden-value"));
  assert.equal(rendered(findings).includes(pub), false);
});

test("flags a bip39 phrase and a bare jwt without printing them", () => {
  const phrase = `${"abandon ".repeat(11)}abandon`;
  const longer = `${"zoo ".repeat(23)}zoo`;
  const header = Buffer.from('{"alg":"none"}').toString("base64url");
  const payload = Buffer.from('{"sub":"demo"}').toString("base64url");
  const sig = Buffer.from("not-a-real-signature").toString("base64url");
  const jwt = `${header}.${payload}.${sig}`;
  const prose = "reports and security findings are not points actions and are not shown";
  const dir = writeDist({
    "assets/app.js": [phrase, longer, jwt, prose].map((item) => JSON.stringify(item)).join("\n"),
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.ok(rules(findings).includes("mnemonic"));
  assert.ok(rules(findings).includes("jwt"));
  const text = rendered(findings);
  assert.equal(text.includes("abandon"), false);
  assert.equal(text.includes("zoo"), false);
  assert.equal(text.includes(jwt), false);
  assert.equal(text.includes(prose), false);
});

test("does not treat a public address as secret material", () => {
  const addr = `0x${randomBytes(20).toString("hex")}`;
  const dir = writeDist({
    "assets/app.js": `const name = "VITE_TOKEN_ADDRESS"; const v = "${addr}";\n`,
  });
  assert.deepEqual(
    scanDist(dir, { knownRoots: [], env: { VITE_TOKEN_ADDRESS: addr, FOO_TOKEN_V2: addr } }),
    [],
  );
});

test("rejects a wildcard or an uncommented allowlist entry", () => {
  const star = parseAllowlist("ab*cd # public value\n");
  assert.equal(star.errors.length, 1);
  assert.equal(star.errors[0].rule, "allowlist");
  assert.equal(star.values.size, 0);
  const bare = parseAllowlist("abcdef\n");
  assert.equal(bare.errors.length, 1);
  assert.equal(bare.errors[0].rule, "allowlist");
  const reviewed = parseAllowlist(fs.readFileSync(path.join(here, "secretScanAllowlist.txt"), "utf8"));
  assert.deepEqual(reviewed.errors, []);
  assert.equal(reviewed.values.size, 0);
  const body = hex64();
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(body)}\n` });
  assert.equal(
    scanDist(dir, { knownRoots: [], allowlist: new Set([body]) }).some((finding) => finding.rule === "hex64"),
    false,
  );
  const other = hex64();
  const blocked = writeDist({ "assets/app.js": `${JSON.stringify(other)}\n` });
  assert.equal(
    scanDist(blocked, { knownRoots: [], allowlist: new Set([body]) }).some((finding) => finding.rule === "hex64"),
    true,
  );
});

test("skips unbundled test files in the source hex check", () => {
  const hidden = hex64();
  const visible = hex64();
  const root = tempDir();
  fs.writeFileSync(path.join(root, "plant.test.ts"), `export const X = "0x${hidden}";\n`);
  fs.writeFileSync(path.join(root, "plant.test.tsx"), `export const Z = "0x${hidden}";\n`);
  fs.writeFileSync(path.join(root, "plant.ts"), `export const Y = "0x${visible}";\n`);
  const findings = scanHexLiterals([root]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "hex64-literal");
  assert.equal(formatFinding(findings[0]).includes(hidden), false);
  assert.equal(formatFinding(findings[0]).includes(visible), false);
});

test("follows an inside symlink and fails a link that leaves the root", () => {
  const dir = writeDist({
    "index.html": "<!doctype html>\n",
    "assets/app.js": "console.log(1)\n",
  });
  fs.writeFileSync(path.join(dir, "assets", "hidden.js"), "const RELAYER_BASE_URL = 1;\n");
  fs.symlinkSync("hidden.js", path.join(dir, "assets", "alias.js"));
  const outside = tempDir();
  const secret = hex64();
  fs.writeFileSync(path.join(outside, "outside.js"), secret);
  fs.symlinkSync(path.join(outside, "outside.js"), path.join(dir, "assets", "out.js"));
  fs.symlinkSync(path.join(dir, "assets", "missing.js"), path.join(dir, "assets", "broken.js"));
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.ok(rules(findings).includes("relayer-env-key"));
  assert.ok(rules(findings).includes("symlink"));
  const text = rendered(findings);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("outside.js"), false);
  assert.equal(text.includes("RELAYER_BASE_URL"), false);
  assert.match(text, /assets\/out\.js:1:1 symlink/);
  assert.match(text, /assets\/broken\.js:1:1 symlink/);
});
