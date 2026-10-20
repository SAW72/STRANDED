/**
 * Fail the wallet build if the public bundle contains Relayer secret material.
 *
 * A 64-hex string is a standalone token of 64 hex digits, with or without a
 * 0x prefix. It is not a slice of a longer hex run (bytecode). Tokens that
 * already occur in wallet/src or wallet/node_modules are public constants
 * (the dry-mock path hash, curve parameters, typed-data hashes). A token that
 * exists only in dist was introduced by the build environment. CI sets
 * RELAYER_PRIVATE_KEY and ADMIN_SECRET to runtime canaries so this check
 * proves those values were not inlined. Canaries are never printed.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELAYER_KEY = /(?<![A-Za-z0-9_])(RELAYER_[A-Z0-9_]+)/g;
const ADMIN_KEY = /(?<![A-Za-z0-9_])ADMIN_SECRET(?![A-Za-z0-9_])/g;
const HEX64 = /(?<![A-Za-z0-9])(?:0x)?([0-9a-fA-F]{64})(?![A-Za-z0-9])/gi;

const ENV_VALUE_NAMES = ["RELAYER_PRIVATE_KEY", "ADMIN_SECRET"];

export function fingerprint(body) {
  return createHash("sha256").update(String(body).toLowerCase()).digest("hex").slice(0, 12);
}

function walkFiles(dir) {
  const out = [];
  const root = fs.realpathSync(dir);
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function bodyInRoots(body, roots) {
  if (!/^[0-9a-f]{64}$/.test(body)) {
    throw new Error("refusing to search a non-hex body");
  }
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const result = spawnSync(
      "grep",
      ["-R", "-a", "-I", "-F", "-i", "-q", "-m", "1", "--", body, root],
      { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status === 0) return true;
  }
  return false;
}

function isKnownHex(body, options) {
  const lower = body.toLowerCase();
  if (options.knownBodies?.has(lower)) return true;
  const roots = options.knownRoots ?? [];
  if (roots.length > 0) return bodyInRoots(lower, roots);
  return false;
}

export function forbiddenFromEnv(env = process.env) {
  const seen = new Set();
  const out = [];
  for (const name of ENV_VALUE_NAMES) {
    const raw = env[name];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length < 8 || seen.has(value)) continue;
    seen.add(value);
    out.push({ name, value });
    const hex = value.replace(/^0x/i, "");
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      const withPrefix = `0x${hex}`;
      if (!seen.has(withPrefix)) {
        seen.add(withPrefix);
        out.push({ name, value: withPrefix });
      }
      if (!seen.has(hex)) {
        seen.add(hex);
        out.push({ name, value: hex });
      }
    }
  }
  return out;
}

/**
 * @param {string} distDir
 * @param {{ knownBodies?: Set<string>, knownRoots?: string[], forbiddenValues?: {name: string, value: string}[] }} [options]
 * @returns {{ kind: string, file: string, detail: string }[]}
 */
export function scanDist(distDir, options = {}) {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`dist directory not found: ${distDir}`);
  }
  const findings = [];
  const forbidden = options.forbiddenValues ?? [];
  for (const file of walkFiles(distDir)) {
    const text = fs.readFileSync(file, "latin1");
    const rel = path.relative(distDir, file) || path.basename(file);

    if (ADMIN_KEY.test(text)) {
      findings.push({ kind: "admin-secret", file: rel, detail: "ADMIN_SECRET" });
    }
    ADMIN_KEY.lastIndex = 0;

    const relayerNames = new Set();
    for (const match of text.matchAll(RELAYER_KEY)) {
      relayerNames.add(match[1]);
    }
    for (const name of relayerNames) {
      findings.push({
        kind: name === "RELAYER_PRIVATE_KEY" ? "relayer-private-key" : "relayer-env-key",
        file: rel,
        detail: name,
      });
    }

    const hexBodies = new Set();
    for (const match of text.matchAll(HEX64)) {
      hexBodies.add(match[1].toLowerCase());
    }
    for (const body of hexBodies) {
      if (isKnownHex(body, options)) continue;
      findings.push({
        kind: "hex64",
        file: rel,
        detail: `sha256:${fingerprint(body)}`,
      });
    }

    for (const item of forbidden) {
      if (item.value && text.includes(item.value)) {
        findings.push({
          kind: "forbidden-value",
          file: rel,
          detail: item.name,
        });
      }
    }
  }
  return findings;
}

export function formatFinding(finding) {
  return `${finding.kind} ${finding.detail} ${finding.file}`;
}

function defaultRoots(cwd) {
  return ["src", "node_modules"]
    .map((name) => path.resolve(cwd, name))
    .filter((dir) => fs.existsSync(dir));
}

function parseArgs(argv) {
  const roots = [];
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const next = argv[i + 1];
      if (!next) throw new Error("--root requires a directory");
      roots.push(next);
      i += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { distDir: positionals[0], roots };
}

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const { distDir, roots } = parseArgs(argv);
  if (!distDir) {
    process.stderr.write("usage: node checkDistSecrets.mjs <dist> [--root dir]\n");
    return 2;
  }
  const knownRoots = roots.length > 0 ? roots : defaultRoots(cwd);
  const findings = scanDist(distDir, {
    knownRoots,
    forbiddenValues: forbiddenFromEnv(env),
  });
  if (findings.length === 0) {
    process.stdout.write(`bundle secret check passed (${knownRoots.length} known-constant roots)\n`);
    return 0;
  }
  process.stderr.write(`bundle secret check failed (${findings.length})\n`);
  for (const finding of findings) {
    process.stderr.write(`${formatFinding(finding)}\n`);
  }
  return 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  process.exit(main());
}
