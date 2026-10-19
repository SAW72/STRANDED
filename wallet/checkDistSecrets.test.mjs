import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
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

let cachedWords;

function wordList() {
  if (!cachedWords) {
    cachedWords = fs.readFileSync(path.join(here, "bip39-english.txt"), "utf8").trim().split(/\s+/);
  }
  return cachedWords;
}

function bip39Phrase(count) {
  const words = wordList();
  const checksumBits = count / 3;
  const entropy = randomBytes((count * 11 - checksumBits) / 8);
  const hash = createHash("sha256").update(entropy).digest();
  let bits = "";
  for (const byte of entropy) bits += byte.toString(2).padStart(8, "0");
  bits += [...hash].map((byte) => byte.toString(2).padStart(8, "0")).join("");
  bits = bits.slice(0, count * 11);
  const phrase = [];
  for (let i = 0; i < count; i += 1) {
    phrase.push(words[Number.parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
  }
  return phrase;
}

function checksumDistance(words) {
  const list = wordList();
  const indexes = words.map((word) => list.indexOf(word));
  const checksumBits = indexes.length / 3;
  let bits = "";
  for (const index of indexes) bits += index.toString(2).padStart(11, "0");
  const entropyBits = bits.slice(0, bits.length - checksumBits);
  const checksum = bits.slice(bits.length - checksumBits);
  const entropy = Buffer.alloc(entropyBits.length / 8);
  for (let i = 0; i < entropy.length; i += 1) {
    entropy[i] = Number.parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  }
  const hash = createHash("sha256").update(entropy).digest();
  let hashBits = "";
  for (const byte of hash) hashBits += byte.toString(2).padStart(8, "0");
  let distance = 0;
  for (let i = 0; i < checksum.length; i += 1) {
    if (checksum[i] !== hashBits[i]) distance += 1;
  }
  return distance;
}

function windowValid(words, size) {
  if (words.length < size) return false;
  for (let i = 0; i + size <= words.length; i += 1) {
    if (checksumDistance(words.slice(i, i + size)) === 0) return true;
  }
  return false;
}

function isolatedPhrase(count) {
  const shorter = [12, 15, 18, 21, 24].filter((size) => size < count);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const words = bip39Phrase(count);
    if (shorter.every((size) => !windowValid(words, size))) return words;
  }
  throw new Error(`no isolated ${count}-word phrase`);
}

function flipChecksumBit(words, which) {
  const list = wordList();
  const index = list.indexOf(words[words.length - 1]);
  const bit = which === "last" ? 1 : 1 << (words.length / 3 - 1);
  return [...words.slice(0, -1), list[index ^ bit]];
}

function exampleValue(name) {
  const text = fs.readFileSync(path.join(here, ".env.example"), "utf8");
  const line = text.split(/\n/).find((item) => item.startsWith(`${name}=`));
  assert.ok(line, name);
  return line.slice(name.length + 1).trim();
}

function digestHex(label) {
  return createHash("sha256").update(label).digest("hex");
}

function digitRun(label, length) {
  const raw = digestHex(label).replace(/[a-f]/g, "");
  return `${raw}7654321987654321`.slice(0, length);
}

function hexLetterRun(label, length) {
  return digestHex(label).replace(/[0-9]/g, "a").slice(0, length);
}

function mixedUser(label) {
  return `g${digestHex(label).slice(0, 6)}Z9`;
}

function hexUuid(label) {
  const raw = digestHex(label);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function hexHyphen(label) {
  const raw = digestHex(label);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 14)}`;
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

test("compares an rpc url only when it carries a key", () => {
  const pub = "https://public.example.invalid/rpc";
  const base = exampleValue("VITE_BASE_SEPOLIA_RPC_URL");
  const arb = exampleValue("VITE_ARB_SEPOLIA_RPC_URL");
  assert.equal(isKeyLikeRpc(pub), false);
  assert.equal(isKeyLikeRpc(base), false);
  assert.equal(isKeyLikeRpc(arb), false);
  const dir = writeDist({
    "assets/app.js": [pub, base, arb].map((item) => JSON.stringify(item)).join("\n"),
  });
  assert.deepEqual(
    scanDist(dir, {
      knownRoots: [],
      env: {
        VITE_BASE_SEPOLIA_RPC_URL: base,
        VITE_ARB_SEPOLIA_RPC_URL: arb,
        RPC_URL: pub,
      },
    }),
    [],
  );
  const key = randomBytes(16).toString("hex");
  const keyed = `https://rpc.example.invalid/v2/${key}`;
  const keyedDir = writeDist({ "assets/app.js": `${JSON.stringify(keyed)}\n` });
  const findings = scanDist(keyedDir, { knownRoots: [], env: { VITE_BASE_SEPOLIA_RPC_URL: keyed } });
  assert.ok(rules(findings).includes("forbidden-value"));
  assert.equal(rendered(findings).includes(key), false);
  assert.equal(rendered(findings).includes(keyed), false);
});

test("a keyed url does not fail when only its public host is already bundled", () => {
  const host = "https://public.example.invalid";
  const key = randomBytes(16).toString("hex");
  const keyed = `${host}/v2/${key}`;
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(`${host}/rpc`)}\n` });
  const findings = scanDist(dir, { knownRoots: [], env: { VITE_BASE_SEPOLIA_RPC_URL: keyed } });
  assert.equal(findings.some((finding) => finding.rule === "forbidden-value"), false);
  assert.equal(findings.some((finding) => finding.rule === "forbidden-split"), false);
  assert.equal(rendered(findings).includes(key), false);
});

function assertMnemonic(body) {
  const dir = writeDist({ "assets/app.js": `${body}\n` });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(findings.some((finding) => finding.rule === "mnemonic"), true);
  assert.equal(rendered(findings).includes(body), false);
}

test("flags a checksummed phrase and a bare jwt without printing them", () => {
  for (const count of [12, 15, 18, 21, 24]) {
    const words = bip39Phrase(count);
    assertMnemonic(words.join(" "));
    assertMnemonic(words.join("\n"));
    assertMnemonic(words.join("  "));
    assertMnemonic(words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" "));
    assertMnemonic(`[${words.map((word) => JSON.stringify(word)).join(",")}]`);
  }
  const header = Buffer.from('{"alg":"none"}').toString("base64url");
  const payload = Buffer.from('{"sub":"demo"}').toString("base64url");
  const sig = Buffer.from("not-a-real-signature").toString("base64url");
  const jwt = `${header}.${payload}.${sig}`;
  const prose = "you can enjoy any coffee day before work again only during summer";
  const older = "reports and security findings are not points actions and are not shown";
  const jwtDir = writeDist({
    "assets/app.js": `${JSON.stringify(jwt)}\n${prose}\n${older}\n`,
  });
  const jwtFindings = scanDist(jwtDir, { knownRoots: [], env: {} });
  assert.ok(rules(jwtFindings).includes("jwt"));
  assert.equal(rules(jwtFindings).includes("mnemonic"), false);
  const jwtText = rendered(jwtFindings);
  assert.equal(jwtText.includes(jwt), false);
  assert.equal(jwtText.includes(header), false);
  for (const body of [
    `${"abandon ".repeat(11)}abandon`,
    `${"abandon ".repeat(15)}abandon`,
    prose,
    older,
  ]) {
    const dir = writeDist({ "assets/app.js": `${body}\n` });
    assert.equal(scanDist(dir, { knownRoots: [], env: {} }).some((finding) => finding.rule === "mnemonic"), false);
  }
  const switches = Array.from({ length: 24 }, (_, index) => `case ${index}:`).join("");
  const switched = writeDist({ "assets/app.js": switches });
  assert.equal(
    scanDist(switched, { knownRoots: [], env: {} }).some((finding) => finding.rule === "mnemonic"),
    false,
  );
});

test("finds a checksummed phrase inside a longer word run and an inlined array", () => {
  const words = bip39Phrase(12);
  const wrapped = ["you", ...words, "zoo"].join(" ");
  assertMnemonic(wrapped);
  const array = JSON.stringify(words);
  const dir = writeDist({ "assets/app.js": `const list = ${array};\n` });
  const findings = scanDist(dir, { knownRoots: [], env: { VITE_MNEMONIC: array } });
  assert.ok(rules(findings).includes("mnemonic"));
  assert.equal(rendered(findings).includes(words[0]), false);
  const source = scanHexText("plant.ts", `${words.join("\n")}\n`);
  assert.equal(source.some((finding) => finding.rule === "mnemonic"), true);
  assert.equal(formatFinding(source[0]).includes(words[0]), false);
});

test("flags a jwt whose parts are joined at the dots", () => {
  const header = Buffer.from('{"alg":"none"}').toString("base64url");
  const payload = Buffer.from('{"sub":"demo"}').toString("base64url");
  const sig = Buffer.from("not-a-real-signature").toString("base64url");
  const joined = `${JSON.stringify(header)} + "." + ${JSON.stringify(payload)} + "." + ${JSON.stringify(sig)}`;
  const dir = writeDist({ "assets/app.js": `const value = ${joined};\n` });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.ok(rules(findings).includes("jwt"));
  const text = rendered(findings);
  assert.equal(text.includes(header), false);
  assert.equal(text.includes(payload), false);
  assert.equal(text.includes(sig), false);
});

test("flags username-only userinfo, a short ankr key, and a fragment key", () => {
  const user = randomBytes(6).toString("hex");
  let ankrKey = randomBytes(5).toString("hex");
  if (!/[0-9]/.test(ankrKey)) ankrKey = `a1${ankrKey.slice(2)}`;
  const fragmentKey = randomBytes(16).toString("hex");
  const userUrl = `https://${user}@rpc.example.invalid/rpc`;
  const ankrUrl = `https://rpc.ankr.example.invalid/eth/${ankrKey}`;
  const fragmentUrl = `https://rpc.example.invalid/eth#${fragmentKey}`;
  const queryFragment = `https://rpc.example.test/eth#dkey=${fragmentKey}`;
  assert.equal(isKeyLikeRpc(userUrl), true);
  assert.equal(isKeyLikeRpc("https://ab@rpc.example.invalid/rpc"), false);
  assert.equal(isKeyLikeRpc(ankrUrl), true);
  assert.equal(isKeyLikeRpc("https://rpc.ankr.example.invalid/eth"), false);
  assert.equal(isKeyLikeRpc(fragmentUrl), true);
  assert.equal(isKeyLikeRpc(queryFragment), true);
  const dir = writeDist({
    "assets/app.js": [userUrl, ankrUrl, fragmentUrl, queryFragment].map((item) => JSON.stringify(item)).join("\n"),
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(findings.filter((finding) => finding.rule === "rpc-url").length, 4);
  const text = rendered(findings);
  assert.equal(text.includes(user), false);
  assert.equal(text.includes(ankrKey), false);
  assert.equal(text.includes(fragmentKey), false);
});

test("an unlisted address fails and a listed address passes", () => {
  const addr = `0x${randomBytes(20).toString("hex")}`;
  const dir = writeDist({
    "assets/app.js": `const name = "VITE_TOKEN_ADDRESS"; const v = "${addr}";\n`,
  });
  const open = scanDist(dir, { knownRoots: [], env: { VITE_TOKEN_ADDRESS: addr, FOO_TOKEN_V2: addr } });
  assert.ok(rules(open).includes("forbidden-value"));
  assert.equal(rendered(open).includes(addr), false);
  const listed = scanDist(dir, {
    knownRoots: [],
    env: { VITE_TOKEN_ADDRESS: addr, FOO_TOKEN_V2: addr },
    allowlist: new Set([addr]),
  });
  assert.deepEqual(listed, []);
});

test("a non-address value passes only when its exact value is listed", () => {
  const symbol = "demo-symbol";
  const dir = writeDist({ "assets/app.js": `const v = ${JSON.stringify(symbol)};\n` });
  const open = scanDist(dir, { knownRoots: [], env: { FOO_TOKEN_V2: symbol } });
  assert.ok(rules(open).includes("forbidden-value"));
  assert.equal(rendered(open).includes(symbol), false);
  const listed = scanDist(dir, {
    knownRoots: [],
    env: { FOO_TOKEN_V2: symbol },
    allowlist: new Set([symbol]),
  });
  assert.deepEqual(listed, []);
});

test("allows a relayer lookalike only by an exact name entry", () => {
  const dir = writeDist({
    "assets/app.js": "const RELAYER_FETCH_TIMEOUT_MS = 1;\nconst RELAYER_OTHER_NAME = 2;\n",
  });
  const open = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(open.filter((finding) => finding.rule === "relayer-env-key").length, 2);
  const listed = scanDist(dir, {
    knownRoots: [],
    env: {},
    allowlist: new Set(["RELAYER_FETCH_TIMEOUT_MS"]),
  });
  assert.equal(listed.filter((finding) => finding.rule === "relayer-env-key").length, 1);
  assert.equal(rendered(listed).includes("RELAYER_FETCH_TIMEOUT_MS"), false);
  assert.equal(rendered(listed).includes("RELAYER_OTHER_NAME"), false);
  const keyDir = writeDist({ "assets/app.js": "const RELAYER_PRIVATE_KEY = 1;\n" });
  const still = scanDist(keyDir, {
    knownRoots: [],
    env: {},
    allowlist: new Set(["RELAYER_PRIVATE_KEY"]),
  });
  assert.ok(rules(still).includes("relayer-private-key"));
});

test("rejects a wildcard or an uncommented allowlist entry", () => {
  const star = parseAllowlist("ab*cd # public value\n");
  assert.equal(star.errors.length, 1);
  assert.equal(star.errors[0].rule, "allowlist");
  assert.equal(star.values.size, 0);
  const mark = parseAllowlist("ab?cd # public value\n");
  assert.equal(mark.errors.length, 1);
  assert.equal(mark.errors[0].rule, "allowlist");
  assert.equal(mark.values.size, 0);
  const bare = parseAllowlist("abcdef\n");
  assert.equal(bare.errors.length, 1);
  assert.equal(bare.errors[0].rule, "allowlist");
  const reviewed = parseAllowlist(fs.readFileSync(path.join(here, "secretScanAllowlist.txt"), "utf8"));
  assert.deepEqual(reviewed.errors, []);
  assert.equal(reviewed.values.has(exampleValue("VITE_TOKEN_ADDRESS")), true);
  assert.equal(reviewed.values.has(exampleValue("VITE_TOKEN_ADDRESS_ARB_SEPOLIA")), true);
  const placeholder = parseAllowlist(
    fs.readFileSync(path.join(here, "secretScanPlaceholderAllowlist.txt"), "utf8"),
    "secretScanPlaceholderAllowlist.txt",
  );
  assert.deepEqual(placeholder.errors, []);
  assert.equal(placeholder.values.size, 0);
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

test("scans test files with a placeholder allowlist", () => {
  const hidden = hex64();
  const visible = hex64();
  const root = tempDir();
  fs.writeFileSync(path.join(root, "plant.test.ts"), `export const X = "0x${hidden}";\n`);
  fs.writeFileSync(path.join(root, "plant.test.tsx"), `export const Z = "0x${visible}";\n`);
  fs.writeFileSync(path.join(root, "plant.ts"), `export const Y = "0x${visible}";\n`);
  const open = scanHexLiterals([root], { placeholderAllowlist: new Set() });
  assert.equal(open.length, 3);
  assert.ok(open.every((finding) => finding.rule === "hex64-literal"));
  const covered = scanHexLiterals([root], { placeholderAllowlist: new Set([hidden]) });
  assert.equal(covered.length, 2);
  assert.ok(covered.every((finding) => !finding.file.endsWith("plant.test.ts")));
  assert.equal(covered.map((finding) => formatFinding(finding)).join("\n").includes(hidden), false);
  assert.equal(covered.map((finding) => formatFinding(finding)).join("\n").includes(visible), false);
});

test("allowlist covers a public query key and an explorer tx link", () => {
  const banner = "https://cdn.example.invalid/app?key=hero-banner-2026";
  const txHash = `0x${"c".repeat(64)}`;
  const tx = `https://explorer.example.invalid/tx/${txHash}`;
  assert.equal(isKeyLikeRpc(banner), true);
  assert.equal(isKeyLikeRpc(tx), true);
  const dir = writeDist({
    "assets/app.js": `${JSON.stringify(banner)}\n${JSON.stringify(tx)}\n`,
  });
  const open = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(open.filter((finding) => finding.rule === "rpc-url").length, 2);
  const listed = scanDist(dir, { knownRoots: [], env: {}, allowlist: new Set([banner, tx]) });
  assert.equal(listed.some((finding) => finding.rule === "rpc-url"), false);
  assert.equal(rendered(listed).includes("hero-banner-2026"), false);
  assert.equal(rendered(listed).includes(txHash), false);
});

test("an allowlisted secret value still fails as raw text, base64, and two halves", () => {
  for (const name of [
    "RELAYER_PRIVATE_KEY",
    "ADMIN_SECRET",
    "VITE_API_SECRET",
    "VITE_PRIVATE_KEY",
    "VITE_MNEMONIC",
    "VITE_SEED",
    "VITE_DB_PASSWORD",
    "RELAYER_KEY",
    "ETHERSCAN_API_KEY",
    "DEPLOYER_PK",
    "RECOVERY_PHRASE",
    "DB_PASSWD",
    "GCP_CREDENTIAL",
    "VITE_ACCESS_TOKEN",
    "VITE_PRIV_KEY",
    "VITE_SIGNER_KEY",
  ]) {
    const value = hex64();
    const encoded = Buffer.from(value, "utf8").toString("base64");
    const mid = value.length / 2;
    const allowlist = new Set([value]);
    const env = { [name]: value };
    const raw = writeDist({ "assets/app.js": `${JSON.stringify(value)}\n` });
    const rawHits = scanDist(raw, { knownRoots: [], env, allowlist });
    assert.ok(rules(rawHits).includes("forbidden-value"), name);
    assert.equal(rendered(rawHits).includes(value), false);
    const encodedDir = writeDist({ "assets/app.js": `${JSON.stringify(encoded)}\n` });
    const encodedHits = scanDist(encodedDir, { knownRoots: [], env, allowlist });
    assert.ok(rules(encodedHits).includes("forbidden-encoding"), name);
    assert.equal(rendered(encodedHits).includes(value), false);
    assert.equal(rendered(encodedHits).includes(encoded), false);
    const halves = writeDist({
      "assets/a.js": `${JSON.stringify(value.slice(0, mid))}\n`,
      "assets/b.js": `${JSON.stringify(value.slice(mid))}\n`,
    });
    const halfHits = scanDist(halves, { knownRoots: [], env, allowlist });
    assert.ok(rules(halfHits).includes("forbidden-split"), name);
    assert.equal(rendered(halfHits).includes(value), false);
    assert.equal(rendered(halfHits).includes(value.slice(0, mid)), false);
    assert.equal(rendered(halfHits).includes(value.slice(mid)), false);
  }
});

test("a non-hex allowlisted value under a protected name still fails", () => {
  const value = `qa-${randomBytes(16).toString("hex")}`;
  for (const name of [
    "vite_db_password",
    "VITE_PRIVATE_KEY",
    "VITE_MNEMONIC",
    "VITE_SEED",
    "VITE_DB_PASSWORD",
    "RELAYER_KEY",
    "ETHERSCAN_API_KEY",
    "DEPLOYER_PK",
    "RECOVERY_PHRASE",
    "DB_PASSWD",
    "GCP_CREDENTIAL",
    "VITE_API_SECRET",
    "VITE_ACCESS_TOKEN",
    "VITE_PRIV_KEY",
    "VITE_SIGNER_KEY",
  ]) {
    const dir = writeDist({ "assets/app.js": `${JSON.stringify(value)}\n` });
    const hits = scanDist(dir, { knownRoots: [], env: { [name]: value }, allowlist: new Set([value]) });
    assert.ok(rules(hits).includes("forbidden-value"), name);
    assert.equal(rendered(hits).includes(value), false);
  }
});

test("a listed address or id whose name contains TOKEN passes, and 64 hex does not", () => {
  const address = `0x${randomBytes(20).toString("hex")}`;
  const addressDir = writeDist({ "assets/app.js": `${JSON.stringify(address)}\n` });
  assert.deepEqual(
    scanDist(addressDir, {
      knownRoots: [],
      env: { VITE_TOKEN_ADDRESS: address },
      allowlist: new Set([address]),
    }),
    [],
  );
  const id = "public-id-84532";
  const idDir = writeDist({ "assets/app.js": `${JSON.stringify(id)}\n` });
  assert.deepEqual(
    scanDist(idDir, {
      knownRoots: [],
      env: { VITE_TOKEN_ID: id },
      allowlist: new Set([id]),
    }),
    [],
  );
  const body = hex64();
  const hexDir = writeDist({ "assets/app.js": `${JSON.stringify(body)}\n` });
  const hexHits = scanDist(hexDir, {
    knownRoots: [],
    env: { FOO_TOKEN_V2: body },
    allowlist: new Set([body]),
  });
  assert.ok(rules(hexHits).includes("forbidden-value"));
  assert.equal(rendered(hexHits).includes(body), false);
});

test("an allowlisted keyed url still fails for the value, the key, and its base64", () => {
  const key = randomBytes(16).toString("hex");
  const keyed = `https://rpc.example.invalid/v2/${key}`;
  const encoded = Buffer.from(keyed, "utf8").toString("base64");
  const allowlist = new Set([keyed, key, encoded]);
  const env = { RPC_URL: keyed };
  const full = writeDist({ "assets/app.js": `${JSON.stringify(keyed)}\n` });
  const fullHits = scanDist(full, { knownRoots: [], env, allowlist });
  assert.ok(rules(fullHits).includes("forbidden-value"));
  assert.equal(rendered(fullHits).includes(key), false);
  const keyOnly = writeDist({ "assets/app.js": `${JSON.stringify(key)}\n` });
  const keyHits = scanDist(keyOnly, { knownRoots: [], env, allowlist });
  assert.ok(rules(keyHits).includes("forbidden-value"));
  assert.equal(rendered(keyHits).includes(key), false);
  const encodedDir = writeDist({ "assets/app.js": `${JSON.stringify(encoded)}\n` });
  const encodedHits = scanDist(encodedDir, { knownRoots: [], env, allowlist });
  assert.ok(rules(encodedHits).includes("forbidden-encoding"));
  assert.equal(rendered(encodedHits).includes(key), false);
  assert.equal(rendered(encodedHits).includes(encoded), false);
});

test("parseAllowlist rejects a keyed provider url and keeps a public query and an explorer link", () => {
  const key = randomBytes(16).toString("hex");
  const rejected = parseAllowlist(`https://rpc.example.invalid/v2/${key} # reviewed\n`);
  assert.equal(rejected.values.size, 0);
  assert.equal(rejected.errors.length, 1);
  assert.equal(rejected.errors[0].rule, "allowlist");
  assert.equal(rejected.errors[0].detail, "keyed provider URL");
  assert.match(formatFinding(rejected.errors[0]), /allowlist keyed provider URL/);
  const queryKey = randomBytes(8).toString("hex");
  const queryRejected = parseAllowlist(`https://rpc.example.invalid/rpc?apikey=${queryKey} # reviewed\n`);
  assert.equal(queryRejected.values.size, 0);
  assert.equal(queryRejected.errors[0].detail, "keyed provider URL");
  const banner = "https://cdn.example.invalid/app?key=hero-banner-2026";
  const tx = `https://explorer.example.invalid/tx/0x${"c".repeat(64)}`;
  const accepted = parseAllowlist(`${banner} # public banner\n${tx} # public tx\n`);
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.values.has(banner), true);
  assert.equal(accepted.values.has(tx), true);
});

test("an allowlist prefix does not skip a longer public value", () => {
  const symbol = "demo-symbol-value";
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(symbol)}\n` });
  const env = { FOO_TOKEN_V2: symbol };
  const byPrefix = scanDist(dir, {
    knownRoots: [],
    env,
    allowlist: new Set([symbol.slice(0, 8)]),
  });
  assert.ok(rules(byPrefix).includes("forbidden-value"));
  const byLonger = scanDist(dir, {
    knownRoots: [],
    env,
    allowlist: new Set([`${symbol}-extra`]),
  });
  assert.ok(rules(byLonger).includes("forbidden-value"));
  assert.deepEqual(
    scanDist(dir, { knownRoots: [], env, allowlist: new Set([symbol]) }),
    [],
  );
  assert.equal(rendered(byPrefix).includes(symbol), false);
  assert.equal(rendered(byLonger).includes(symbol), false);
});

test("flags a keyed rpc key alone, beside its host, and as a 16 character slice", () => {
  const host = "https://rpc.example.invalid";
  const key = randomBytes(16).toString("hex");
  const keyed = `${host}/v2/${key}`;
  const keyOnly = writeDist({ "assets/app.js": `${JSON.stringify(key)}\n` });
  const keyHits = scanDist(keyOnly, { knownRoots: [], env: { VITE_BASE_SEPOLIA_RPC_URL: keyed } });
  assert.ok(rules(keyHits).includes("forbidden-value"));
  assert.equal(rendered(keyHits).includes(key), false);
  const split = writeDist({
    "assets/a.js": `${JSON.stringify(`${host}/v2/`)}\n`,
    "assets/b.js": `${JSON.stringify(key)}\n`,
  });
  const splitHits = scanDist(split, { knownRoots: [], env: { RPC_URL: keyed } });
  assert.ok(rules(splitHits).includes("forbidden-value"));
  assert.equal(rendered(splitHits).includes(key), false);
  const hostOnly = writeDist({ "assets/app.js": `${JSON.stringify(`${host}/v2/`)}\n` });
  assert.deepEqual(scanDist(hostOnly, { knownRoots: [], env: { RPC_URL: keyed } }), []);
  const slice = key.slice(4, 20);
  const sliceDir = writeDist({ "assets/app.js": `${JSON.stringify(slice)}\n` });
  const sliceHits = scanDist(sliceDir, { knownRoots: [], env: { VITE_ARB_SEPOLIA_RPC_URL: keyed } });
  assert.ok(rules(sliceHits).includes("forbidden-split"));
  assert.equal(rules(sliceHits).includes("forbidden-value"), false);
  assert.equal(rendered(sliceHits).includes(key), false);
  assert.equal(rendered(sliceHits).includes(slice), false);
  let mixed = `k${randomBytes(8).toString("hex")}Z`;
  if (!/[0-9]/.test(mixed)) mixed = `k9${mixed.slice(2)}`;
  const mixedUrl = `${host}/v2/${mixed}`;
  assert.equal(isKeyLikeRpc(mixedUrl), true);
  const mixedDir = writeDist({ "assets/app.js": `${JSON.stringify(mixed)}\n` });
  const mixedHits = scanDist(mixedDir, { knownRoots: [], env: { RPC_URL: mixedUrl } });
  assert.ok(rules(mixedHits).includes("forbidden-value"));
  assert.equal(rendered(mixedHits).includes(mixed), false);
});

test("flags a lone password from userinfo", () => {
  const password = "abcdefghijkl";
  const url = `https://qa:${password}@rpc.example.invalid/rpc`;
  assert.equal(isKeyLikeRpc(url), true);
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(password)}\n` });
  const hits = scanDist(dir, { knownRoots: [], env: { RPC_URL: url } });
  assert.ok(rules(hits).includes("forbidden-value"));
  assert.equal(rendered(hits).includes(password), false);
});

test("matches a hex key part when only an upper-case slice is present", () => {
  let key = randomBytes(16).toString("hex");
  if (!/[a-f]/.test(key.slice(0, 16))) key = `a${key.slice(1)}`;
  const upper = key.slice(0, 16).toUpperCase();
  assert.notEqual(upper, key.slice(0, 16));
  const keyed = `https://rpc.example.invalid/v2/${key}`;
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(upper)}\n` });
  const hits = scanDist(dir, { knownRoots: [], env: { RPC_URL: keyed } });
  assert.ok(rules(hits).includes("forbidden-split"));
  assert.equal(rendered(hits).includes(key), false);
  assert.equal(rendered(hits).includes(upper), false);
});

test("ignores a common or short userinfo word", () => {
  assert.equal(isKeyLikeRpc("https://anonymous@rpc.example.invalid/"), false);
  assert.equal(isKeyLikeRpc("https://qa:password@rpc.example.invalid/"), false);
  assert.equal(isKeyLikeRpc("https://qa:credentials@rpc.example.invalid/"), false);
  const dir = writeDist({ "assets/app.js": "anonymous password credentials\n" });
  const findings = scanDist(dir, {
    knownRoots: [],
    env: {
      RPC_URL: "https://anonymous@rpc.example.invalid/",
      ALT_RPC_URL: "https://qa:password@rpc.example.invalid/",
      OTHER_RPC_URL: "https://qa:credentials@rpc.example.invalid/",
    },
  });
  assert.deepEqual(findings, []);
});

test("does not flag s3, ipfs, or a support-team userinfo url", () => {
  const id = randomBytes(16).toString("hex");
  const s3 = `s3://bucket.example.invalid/${id}`;
  const ipfs = `ipfs://ipfs/${id}`;
  const team = "//support-team@rpc.example.invalid/";
  assert.equal(isKeyLikeRpc(s3), false);
  assert.equal(isKeyLikeRpc(ipfs), false);
  assert.equal(isKeyLikeRpc(team), false);
  const dir = writeDist({
    "assets/app.js": [s3, ipfs, team].map((item) => JSON.stringify(item)).join("\n"),
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(findings.some((finding) => finding.rule === "rpc-url"), false);
});

test("flags access_token, auth, apikey, and x-api-key query values", () => {
  const value = randomBytes(6).toString("hex");
  for (const name of ["access_token", "auth", "apikey", "x-api-key"]) {
    assert.equal(isKeyLikeRpc(`https://rpc.example.invalid/rpc?${name}=${value}`), true, name);
  }
  assert.equal(isKeyLikeRpc(`https://rpc.example.invalid/rpc?access_token=${value.slice(0, 11)}`), false);
});

test("matches an upper-case scheme and a scheme-less userinfo url", () => {
  const user = randomBytes(6).toString("hex");
  const upper = `HTTPS://${user}@rpc.example.invalid/rpc`;
  const relative = `//${user}@rpc.example.invalid/rpc`;
  assert.equal(isKeyLikeRpc(upper), true);
  assert.equal(isKeyLikeRpc(relative), true);
  const dir = writeDist({
    "assets/app.js": `${JSON.stringify(upper)}\n${JSON.stringify(relative)}\n`,
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(findings.filter((finding) => finding.rule === "rpc-url").length, 2);
  assert.equal(rendered(findings).includes(user), false);
});

test("pins ankr host, length, digit, and label boundaries", () => {
  let key = randomBytes(5).toString("hex");
  if (!/[0-9]/.test(key)) key = `a1${key.slice(2)}`;
  assert.equal(isKeyLikeRpc(`https://rpc.example.invalid/eth/${key}`), false);
  assert.equal(isKeyLikeRpc(`https://notankrhost.example.invalid/eth/${key}`), false);
  assert.equal(isKeyLikeRpc("https://rpc.ankr.example.invalid/eth/ab12"), false);
  assert.equal(isKeyLikeRpc("https://rpc.ankr.example.invalid/eth/abc1234"), false);
  assert.equal(isKeyLikeRpc("https://rpc.ankr.example.invalid/eth/abcdefgh"), false);
  assert.equal(isKeyLikeRpc(`https://rpc.ankr.example.invalid/eth/${key}`), true);
});

test("pins fragment key names, path segments, and short query values", () => {
  const named = randomBytes(16).toString("hex");
  const segment = randomBytes(16).toString("hex");
  const query = randomBytes(6).toString("hex");
  assert.equal(isKeyLikeRpc(`https://rpc.example.invalid/eth#${named}=x`), true);
  assert.equal(isKeyLikeRpc(`https://rpc.example.invalid/eth#/v2/${segment}`), true);
  assert.equal(isKeyLikeRpc(`https://rpc.example.invalid/eth#dkey=${query}`), true);
  assert.equal(isKeyLikeRpc(`https://rpc.example.invalid/eth#dkey=${query.slice(0, 11)}`), false);
});

test("flags a single-quoted jwt join in the bundle and in source", () => {
  const header = Buffer.from('{"alg":"none"}').toString("base64url");
  const payload = Buffer.from('{"sub":"demo"}').toString("base64url");
  const sig = Buffer.from("not-a-real-signature").toString("base64url");
  const joined = `'${header}' + '.' + '${payload}' + '.' + '${sig}'`;
  const dir = writeDist({ "assets/app.js": `const value = ${joined};\n` });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.ok(rules(findings).includes("jwt"));
  const source = scanHexText("plant.ts", `${joined}\n`);
  assert.ok(source.some((finding) => finding.rule === "jwt"));
  const text = `${rendered(findings)}\n${source.map((finding) => formatFinding(finding)).join("\n")}`;
  assert.equal(text.includes(header), false);
  assert.equal(text.includes(payload), false);
  assert.equal(text.includes(sig), false);
});

test("rejects a phrase that misses one checksum bit", () => {
  const words = bip39Phrase(12);
  assert.equal(checksumDistance(words), 0);
  for (const which of ["first", "last"]) {
    const flipped = flipChecksumBit(words, which);
    assert.equal(checksumDistance(flipped), 1);
    const dir = writeDist({ "assets/app.js": `${flipped.join(" ")}\n` });
    assert.equal(
      scanDist(dir, { knownRoots: [], env: {} }).some((finding) => finding.rule === "mnemonic"),
      false,
    );
  }
  assertMnemonic(words.join(" "));
});

test("flags 15, 18, 21, and 24 word phrases with no shorter valid window", () => {
  for (const count of [15, 18, 21, 24]) {
    const words = isolatedPhrase(count);
    assert.equal(checksumDistance(words), 0);
    assertMnemonic(words.join(" "));
  }
});

test("a word outside the list breaks a mnemonic run", () => {
  assert.equal(wordList().includes("qqqq"), false);
  const words = bip39Phrase(12);
  const broken = [...words.slice(0, 6), "qqqq", ...words.slice(6)].join(" ");
  const dir = writeDist({ "assets/app.js": `${broken}\n` });
  assert.equal(
    scanDist(dir, { knownRoots: [], env: {} }).some((finding) => finding.rule === "mnemonic"),
    false,
  );
});

test("treats escaped newlines and tabs as mnemonic separators", () => {
  const words = bip39Phrase(12);
  assertMnemonic(words.join("\\n"));
  assertMnemonic(words.join("\\t"));
  assertMnemonic(words.join("\\r"));
  const body = `\\n${words.join(" ")}`;
  const dir = writeDist({ "assets/app.js": body });
  const findings = scanDist(dir, { knownRoots: [], env: {} }).filter((finding) => finding.rule === "mnemonic");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].column, 3);
});

test("SIGTERM guard exits without reporting a pass", async () => {
  const scriptUrl = pathToFileURL(path.join(here, "checkDistSecrets.mjs")).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `import { registerSigtermGuard } from ${JSON.stringify(scriptUrl)};`,
        "registerSigtermGuard();",
        "process.stdout.write('ready\\n');",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ready timeout")), 5000);
    const onData = () => {
      if (!stdout.includes("ready")) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("exited before ready"));
    });
  });
  child.kill("SIGTERM");
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("SIGTERM timeout"));
    }, 5000);
    child.once("exit", (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  assert.equal(code, 143);
  assert.equal(stdout.includes("passed"), false);
  assert.match(stderr, /bundle secret check interrupted/);
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

test("parseAllowlist rejects a uuid or hex-only hyphenated apikey", () => {
  for (const value of [hexUuid("FAKE-K4-UUID"), hexHyphen("FAKE-K4-HYPHEN")]) {
    assert.equal(/[g-z]/i.test(value), false);
    const parsed = parseAllowlist(`https://rpc.example.invalid/rpc?apikey=${value} # reviewed\n`);
    assert.equal(parsed.values.size, 0);
    assert.equal(parsed.errors.length, 1);
    assert.equal(parsed.errors[0].detail, "keyed provider URL");
  }
});

test("parseAllowlist rejects a userinfo-keyed provider url", () => {
  const user = mixedUser("FAKE-K6");
  const parsed = parseAllowlist(`https://${user}@rpc.example.invalid/ # reviewed\n`);
  assert.equal(parsed.values.size, 0);
  assert.equal(parsed.errors[0].detail, "keyed provider URL");
  assert.equal(rendered(parsed.errors).includes(user), false);
});

test("parseAllowlist rejects a fragment-keyed url", () => {
  const key = digestHex("FAKE-K7").slice(0, 20);
  const parsed = parseAllowlist(`https://rpc.example.invalid/rpc#key=${key} # reviewed\n`);
  assert.equal(parsed.values.size, 0);
  assert.equal(parsed.errors[0].detail, "keyed provider URL");
  assert.equal(rendered(parsed.errors).includes(key), false);
});

test("treats short hex, mixed, and long letter usernames as key-like", () => {
  const digits = digitRun("FAKE-Q2-DIGITS", 11);
  const hexLetters = hexLetterRun("FAKE-Q2-HEX", 12);
  const mixed = mixedUser("FAKE-Q3");
  const letters = "notasecretusername";
  assert.equal(/^[0-9]{8,15}$/.test(digits), true);
  assert.equal(/^[a-f]{8,15}$/.test(hexLetters), true);
  assert.equal(/^[A-Za-z0-9]{8,15}$/.test(mixed), true);
  assert.equal(/[g-z]/i.test(mixed) && /[0-9]/.test(mixed), true);
  assert.equal(/^[a-z]{16,}$/.test(letters), true);
  assert.equal(/[g-z]/.test(letters), true);
  assert.equal(isKeyLikeRpc(`https://${digits}@rpc.example.invalid/`), true);
  assert.equal(isKeyLikeRpc(`https://${hexLetters}@rpc.example.invalid/`), true);
  assert.equal(isKeyLikeRpc(`https://${mixed}@rpc.example.invalid/`), true);
  assert.equal(isKeyLikeRpc(`https://${letters}@rpc.example.invalid/`), true);
  assert.equal(isKeyLikeRpc("https://shortname@rpc.example.invalid/"), false);
});

test("flags a key inside a git+https url", () => {
  const user = mixedUser("FAKE-R2");
  const text = `git+https://${user}@rpc.example.invalid/rpc`;
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(text)}\n` });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.ok(rules(findings).includes("rpc-url"));
  assert.equal(rendered(findings).includes(user), false);
});

test("a name with PK inside another word stays allowlistable", () => {
  const value = "upkeep-public-label";
  const name = "VITE_UPKEEP_TOKEN";
  assert.equal(isSecretLikeName(name), true);
  assert.equal(isSecretLikeName("VITE_SPKR"), false);
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(value)}\n` });
  const open = scanDist(dir, { knownRoots: [], env: { [name]: value } });
  assert.ok(rules(open).includes("forbidden-value"));
  const listed = scanDist(dir, {
    knownRoots: [],
    env: { [name]: value },
    allowlist: new Set([value]),
  });
  assert.deepEqual(listed, []);
});

test("an allowlist set passed to scanDist cannot exempt a keyed url", () => {
  const key = digestHex("FAKE-LITERAL-URL").slice(0, 32);
  const keyed = `https://rpc.example.invalid/v2/${key}`;
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(keyed)}\n` });
  const findings = scanDist(dir, { knownRoots: [], env: {}, allowlist: new Set([keyed]) });
  assert.ok(rules(findings).includes("rpc-url"));
  assert.equal(rendered(findings).includes(key), false);
});

test("flags a keyed url after escape text, percent encoding, or a glued prefix", () => {
  const key = digestHex("FAKE-I22").slice(0, 32);
  const url = `https://rpc.example.invalid/v2/${key}`;
  const id = digestHex("FAKE-S3-CONTROL").slice(0, 32);
  const dir = writeDist({
    "qa.json": `{"rpc":"Node:\\n${url}"}`,
    "assets/app.js": [
      `const tabbed = "pre\\t${url}";`,
      `const returned = "pre\\r${url}";`,
      `const encoded = "pre%20${url}";`,
      `const glued = "endpoint${url}";`,
      `const digit = "9${url}";`,
      `const s3 = "s3://bucket.example.invalid/${id}";`,
      `const ipfs = "ipfs://ipfs/${id}";`,
      `const team = "//support-team@rpc.example.invalid/";`,
    ].join("\n"),
  });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(findings.filter((finding) => finding.rule === "rpc-url").length, 6);
  const text = rendered(findings);
  assert.equal(text.includes(key), false);
  assert.equal(text.includes(id), false);
});

test("flags a keyed url at the end of a template literal", () => {
  const key = digestHex("FAKE-I23").slice(0, 32);
  const url = `https://rpc.example.invalid/v2/${key}`;
  const source = [
    "export const rpc = `" + url + "`;",
    "export const wrapped = `Node:\\n" + url + "`;",
  ].join("\n");
  const dir = writeDist({ "plant.ts": `${source}\n` });
  const findings = scanDist(dir, { knownRoots: [], env: {} });
  assert.equal(findings.filter((finding) => finding.rule === "rpc-url").length, 2);
  assert.equal(rendered(findings).includes(key), false);
});

test("credential names cannot be allowlisted when the value is not 64 hex", () => {
  const value = `qa-${digestHex("FAKE-I19R").slice(0, 16)}`;
  for (const name of [
    "VITE_INFURA_KEY",
    "VITE_GITHUB_TOKEN",
    "VITE_ETHERSCAN_APIKEY",
    "VITE_AUTH_TOKEN_V2",
    "VITE_SESSION_TOKEN",
    "VITE_privKey",
    "VITE_signerKey",
    "VITE_PRIVKEY",
    "VITE_SIGNER",
    "VITE_SIGNER_KEY_V2",
    "VITE_PK_HEX",
    "VITE_RELAYER_KEY_HEX",
  ]) {
    const dir = writeDist({ "assets/app.js": `${JSON.stringify(value)}\n` });
    const hits = scanDist(dir, {
      knownRoots: [],
      env: { [name]: value },
      allowlist: new Set([value]),
    });
    assert.ok(rules(hits).includes("forbidden-value"), name);
    assert.equal(rendered(hits).includes(value), false, name);
  }
});

test("an explorer tx hash must be listed and an address link cannot be listed", () => {
  let body = digestHex("FAKE-TX-HASH");
  if (/^([0-9a-f])\1{63}$/i.test(body)) body = `a${body.slice(1)}`;
  const hash = `0x${body}`;
  const tx = `https://explorer.example.invalid/tx/${hash}`;
  const address = `0x${digestHex("FAKE-ADDR").slice(0, 40)}`;
  const addrUrl = `https://explorer.example.invalid/address/${address}`;
  const rejected = parseAllowlist(`${addrUrl} # public address\n`);
  assert.equal(rejected.values.size, 0);
  assert.equal(rejected.errors[0].detail, "keyed provider URL");
  const dir = writeDist({ "assets/app.js": `${JSON.stringify(tx)}\n` });
  const urlOnly = scanDist(dir, { knownRoots: [], env: {}, allowlist: new Set([tx]) });
  assert.ok(rules(urlOnly).includes("hex64"));
  assert.equal(rules(urlOnly).includes("rpc-url"), false);
  const both = scanDist(dir, {
    knownRoots: [],
    env: {},
    allowlist: new Set([tx, body, hash]),
  });
  assert.equal(both.some((finding) => finding.rule === "hex64" || finding.rule === "rpc-url"), false);
  assert.equal(rendered(urlOnly).includes(body), false);
  assert.equal(rendered(rejected.errors).includes(address), false);
});
