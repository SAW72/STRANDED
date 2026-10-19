/**
 * Fail a wallet build when the public bundle or client source contains secret material.
 *
 * Output is file:line and a rule name. Matched values are never printed.
 *
 * Rules:
 * - missing-dist, empty-dist: dist must exist and contain index.html plus a .js file.
 * - relayer-private-key, admin-secret, secret-env-name: those names in built JS (not in source maps).
 * - forbidden-value, forbidden-encoding, forbidden-split: every secret-like env value,
 *   including base64/base64url and a two-part split.
 * - rpc-url: provider-style URLs whose path or query carries a long key segment.
 * - hex64: a standalone 64-hex value in dist that is not a repeated nibble and not
 *   already present under node_modules.
 * - hex64-literal: the same shape committed under client source. The public gitleaks
 *   checksum assignment in .github/workflows/gitleaks.yml is exempt.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const HEX64 = /(?<![A-Za-z0-9])(?:0x)?([0-9a-fA-F]{64})(?![A-Za-z0-9])/gi;
const SECRET_NAME = /(?:SECRET|PRIVATE|(?:^|_)KEY$|(?:^|_)PK$|PASSWD|PASSWORD|CREDENTIAL|API_KEY|APIKEY|_TOKEN$)/;
const ALWAYS_NAMES = ["RELAYER_PRIVATE_KEY", "ADMIN_SECRET"];

export function isSecretLikeName(name) {
  return typeof name === "string" && SECRET_NAME.test(name);
}

export function isRpcName(name) {
  return name === "RPC_URL" || name.endsWith("_RPC_URL");
}

export function isKeyLikeRpc(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol)) return false;
  if (/\/v[0-9]\/[A-Za-z0-9_-]{16,}/.test(url.pathname)) return true;
  for (const [key, val] of url.searchParams) {
    if (/^(?:api[_-]?key|apikey|key|access[_-]?key)$/i.test(key) && String(val).length >= 12) {
      return true;
    }
  }
  return false;
}

function isRepeatedNibble(body) {
  return /^([0-9a-f])\1{63}$/i.test(body);
}

function lineOf(text, index) {
  if (index < 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const root = fs.realpathSync(dir);
  const out = [];
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

function readText(file) {
  return fs.readFileSync(file, "latin1");
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
  if (isRepeatedNibble(lower)) return true;
  if (options.knownBodies?.has(lower)) return true;
  const roots = options.knownRoots ?? [];
  if (roots.length > 0) return bodyInRoots(lower, roots);
  return false;
}

function hexBody(value) {
  const trimmed = value.trim();
  const body = trimmed.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]+$/.test(body) && body.length >= 16 && body.length % 2 === 0) return body;
  return null;
}

function uniqueLong(values, min = 12) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length < min || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function encodingsOf(value) {
  const forms = [];
  const asUtf8 = Buffer.from(value, "utf8");
  forms.push(asUtf8.toString("base64"), asUtf8.toString("base64url"));
  const body = hexBody(value);
  if (body && body.length >= 16) {
    const raw = Buffer.from(body, "hex");
    forms.push(raw.toString("base64"), raw.toString("base64url"));
  }
  return uniqueLong(
    forms.flatMap((form) => [form, form.replace(/=+$/, "")]),
    16,
  ).filter((form) => form !== value);
}

export function secretMaterial(env = {}) {
  const items = [];
  for (const [name, raw] of Object.entries(env)) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length < 8) continue;
    if (/^(?:true|false|yes|no|0|1)$/i.test(value)) continue;
    const secretName = isSecretLikeName(name);
    const rpcName = isRpcName(name);
    if (!secretName && !(rpcName && isKeyLikeRpc(value))) continue;
    const variants = new Set([value]);
    const body = hexBody(value);
    if (body) {
      variants.add(body);
      variants.add(body.toLowerCase());
      variants.add(body.toUpperCase());
      variants.add(`0x${body}`);
      variants.add(`0x${body.toLowerCase()}`);
      variants.add(`0X${body.toUpperCase()}`);
    }
    items.push({
      name,
      value,
      hex: Boolean(body),
      variants: [...variants],
      encodings: encodingsOf(value),
    });
  }
  return items;
}

function boundedName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).exec(text);
  return match ? match.index : -1;
}

function ruleForName(name) {
  if (name === "RELAYER_PRIVATE_KEY") return "relayer-private-key";
  if (name === "ADMIN_SECRET") return "admin-secret";
  return "secret-env-name";
}

function namesToFind(env) {
  const names = new Set(ALWAYS_NAMES);
  for (const item of secretMaterial(env)) names.add(item.name);
  return [...names];
}

function pushFinding(findings, seen, finding) {
  const key = `${finding.file}:${finding.line}:${finding.rule}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

export function bundleShapeFindings(distDir) {
  if (!distDir || !fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    return [{ file: distDir || "dist", line: 1, rule: "missing-dist" }];
  }
  const files = walkFiles(distDir);
  const hasHtml = files.some((file) => path.basename(file) === "index.html");
  const hasJs = files.some((file) => file.endsWith(".js"));
  if (!hasHtml || !hasJs) {
    return [{ file: distDir, line: 1, rule: "empty-dist" }];
  }
  return [];
}

function indexIn(text, needle, hex) {
  const exact = text.indexOf(needle);
  if (exact >= 0) return exact;
  if (!hex) return -1;
  return text.toLowerCase().indexOf(needle.toLowerCase());
}

/**
 * @returns {{ file: string, line: number, rule: string }[]}
 */
export function scanDist(distDir, options = {}) {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) return [];
  const findings = [];
  const seen = new Set();
  const env = options.env ?? {};
  const secrets = secretMaterial(env);
  const names = namesToFind(env);
  const loaded = walkFiles(distDir).map((file) => ({
    file,
    rel: path.relative(distDir, file) || path.basename(file),
    text: readText(file),
    map: file.endsWith(".map"),
  }));

  for (const entry of loaded) {
    if (!entry.map) {
      for (const name of names) {
        const index = boundedName(entry.text, name);
        if (index < 0) continue;
        pushFinding(findings, seen, {
          file: entry.rel,
          line: lineOf(entry.text, index),
          rule: ruleForName(name),
        });
      }
    }

    const hexBodies = new Set();
    for (const match of entry.text.matchAll(HEX64)) hexBodies.add(match[1].toLowerCase());
    HEX64.lastIndex = 0;
    for (const body of hexBodies) {
      if (isKnownHex(body, options)) continue;
      const index = indexIn(entry.text, body, true);
      pushFinding(findings, seen, {
        file: entry.rel,
        line: lineOf(entry.text, index),
        rule: "hex64",
      });
    }

    const urlRe = /https?:\/\/[^\s"'<>]+/g;
    for (const match of entry.text.matchAll(urlRe)) {
      const candidate = match[0].replace(/[),.;]+$/, "");
      if (!isKeyLikeRpc(candidate)) continue;
      pushFinding(findings, seen, {
        file: entry.rel,
        line: lineOf(entry.text, match.index),
        rule: "rpc-url",
      });
    }

    for (const secret of secrets) {
      let rawIndex = -1;
      for (const variant of secret.variants) {
        const index = indexIn(entry.text, variant, secret.hex);
        if (index >= 0) {
          rawIndex = index;
          break;
        }
      }
      if (rawIndex >= 0) {
        pushFinding(findings, seen, {
          file: entry.rel,
          line: lineOf(entry.text, rawIndex),
          rule: "forbidden-value",
        });
      }
      for (const encoded of secret.encodings) {
        const index = entry.text.indexOf(encoded);
        if (index < 0) continue;
        pushFinding(findings, seen, {
          file: entry.rel,
          line: lineOf(entry.text, index),
          rule: "forbidden-encoding",
        });
      }
    }
  }

  for (const secret of secrets) {
    const value = secret.hex ? secret.value.replace(/^0x/i, "") : secret.value;
    if (value.length < 20) continue;
    const mid = Math.floor(value.length / 2);
    const left = value.slice(0, mid);
    const right = value.slice(mid);
    if (left.length < 10 || right.length < 10) continue;
    const full = loaded.some((entry) => indexIn(entry.text, value, secret.hex) >= 0);
    if (full) continue;
    const leftHit = loaded.find((entry) => indexIn(entry.text, left, secret.hex) >= 0);
    const rightHit = loaded.some((entry) => indexIn(entry.text, right, secret.hex) >= 0);
    if (!leftHit || !rightHit) continue;
    const index = indexIn(leftHit.text, left, secret.hex);
    pushFinding(findings, seen, {
      file: leftHit.rel,
      line: lineOf(leftHit.text, index),
      rule: "forbidden-split",
    });
  }

  return findings;
}

export function checksumLineExempt(file, lineText) {
  const norm = file.split(path.sep).join("/");
  if (!norm.endsWith(".github/workflows/gitleaks.yml")) return false;
  return /^\s*GITLEAKS_SHA256=[0-9a-fA-F]{64}\s*(?:#.*)?$/.test(lineText);
}

export function scanHexLiterals(targets) {
  const files = [];
  for (const target of targets) {
    if (!target || !fs.existsSync(target)) continue;
    if (fs.statSync(target).isDirectory()) files.push(...walkFiles(target));
    else files.push(target);
  }
  const findings = [];
  const seen = new Set();
  for (const file of files) {
    const text = readText(file);
    const lines = text.split(/\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const lineText = lines[i];
      if (checksumLineExempt(file, lineText)) continue;
      HEX64.lastIndex = 0;
      const match = HEX64.exec(lineText);
      if (!match) continue;
      if (isRepeatedNibble(match[1])) continue;
      pushFinding(findings, seen, {
        file,
        line: i + 1,
        rule: "hex64-literal",
      });
    }
  }
  return findings;
}

export function formatFinding(finding) {
  return `${finding.file}:${finding.line} ${finding.rule}`;
}

function defaultKnownRoots() {
  const root = path.join(scriptDir, "node_modules");
  return fs.existsSync(root) ? [root] : [];
}

function defaultLiteralTargets() {
  return [
    path.join(scriptDir, "src"),
    path.resolve(scriptDir, "../.github/workflows/gitleaks.yml"),
  ];
}

function parseArgs(argv) {
  const roots = [];
  const positionals = [];
  let sawRoot = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      sawRoot = true;
      const next = argv[i + 1];
      if (!next) throw new Error("--root requires a directory");
      roots.push(next);
      i += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { distDir: positionals[0], roots, sawRoot };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { distDir, roots, sawRoot } = parseArgs(argv);
  if (!distDir) {
    process.stderr.write("usage: node checkDistSecrets.mjs <dist> [--root dir]\n");
    return 2;
  }
  const knownRoots = sawRoot ? roots : defaultKnownRoots();
  const findings = [
    ...bundleShapeFindings(distDir),
    ...scanDist(distDir, { env, knownRoots }),
    ...scanHexLiterals(defaultLiteralTargets()),
  ];
  if (findings.length === 0) {
    process.stdout.write("bundle secret check passed\n");
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
