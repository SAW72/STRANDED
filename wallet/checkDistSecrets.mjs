/**
 * Fail a wallet build when the public bundle or client source contains secret material.
 *
 * Output is file:line:column and a rule name. Matched values are never printed.
 *
 * Rules:
 * - missing-dist, empty-dist: dist must exist and contain index.html plus a .js file.
 * - relayer-private-key, admin-secret, secret-env-name: those names in built JS (not source maps).
 * - forbidden-value, forbidden-encoding, forbidden-split: every secret-like env value,
 *   including base64/base64url and any 16-character slice. An RPC URL is compared only
 *   when it is key-like: the full value, and the key part of that URL. Exact allowlist
 *   values are skipped only after the name gate. A keyed RPC URL is never skipped.
 *   The value list also never skips RELAYER_PRIVATE_KEY, ADMIN_SECRET, a protected
 *   name (API_KEY, APIKEY, ACCESS_TOKEN, PASSWD, PASSWORD, CREDENTIAL, PHRASE,
 *   MNEMONIC, SEED, PRIVATE, PRIV_KEY, PRIVKEY, SIGNER_KEY, SIGNER, RELAYER_KEY,
 *   SECRET, KEY as its own name part, or PK as its own name part), a camelCase part
 *   such as privKey or signerKey, AUTH_TOKEN, SESSION_TOKEN, GITHUB_TOKEN, or a
 *   64-hex value under any secret-like name.
 * - rpc-url: http(s) or ws(s) URLs with a key-like path, query, userinfo, or fragment.
 *   The scheme match is case-insensitive. It also matches git+https and a scheme glued
 *   to escape text, a percent-encoding, or a letter or digit. A backtick ends the match.
 *   A // inside another scheme, such as s3 or ipfs, is not a provider URL. A common or
 *   short user word is not a key part. A password, or high-entropy userinfo, is. An exact
 *   allowlist entry can skip a listed public URL such as an explorer link or a public
 *   query slug. A keyed provider URL cannot be listed, and an allowlist Set passed to
 *   the scan cannot skip one either.
 * - mnemonic: a 12, 15, 18, 21, or 24-word BIP39 English phrase with a valid checksum,
 *   including a sliding window inside a longer run. Newlines, repeated spaces, title case,
 *   quoted arrays, and the escape text \n, \t, and \r count. Approved separators are
 *   whitespace, quotes, commas, and brackets.
 * - jwt: a bare three-part JWT, including parts joined by a dot in source.
 * - hex64: a standalone 64-hex value in dist that is not a repeated nibble, not an exact
 *   allowlist entry, and not already present under node_modules.
 * - hex64-literal: the same shape committed under client source, shared/, or tests.
 *   Test files use the placeholder allowlist. The GITLEAKS_SHA256 assignment in
 *   .github/workflows/gitleaks.yml is exempt only for that exact value.
 * - relayer-env-key: any RELAYER_* name in built JS, unless that exact name is allowlisted.
 * - symlink: a link that is broken or points outside the walked root. Links inside the root are followed.
 * - allowlist: the reviewed allowlist has a wildcard, a value with no comment, or a keyed provider URL.
 *
 * Deliberate obfuscation is out of scope. See DEPLOY.md.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const CHECKSUM_FILE = path.resolve(scriptDir, "../.github/workflows/gitleaks.yml");
const ALLOWLIST_FILE = path.join(scriptDir, "secretScanAllowlist.txt");
const PLACEHOLDER_ALLOWLIST_FILE = path.join(scriptDir, "secretScanPlaceholderAllowlist.txt");
const WORDLIST_FILE = path.join(scriptDir, "bip39-english.txt");
const PHRASE_LENGTHS = new Set([12, 15, 18, 21, 24]);

const HEX64 = /(?<![A-Za-z0-9])(?:0x)?([0-9a-fA-F]{64})(?![A-Za-z0-9])/gi;
const RELAYER_NAME = /(?<![A-Za-z0-9_])RELAYER_[A-Z0-9_]+(?![A-Za-z0-9_])/g;
const JWT = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g;
const JWT_DOT_JOIN = /eyJ[A-Za-z0-9_-]{10,}(?:["']\s*\+\s*["']\.["']\s*\+\s*["']|\.)[A-Za-z0-9_-]{10,}(?:["']\s*\+\s*["']\.["']\s*\+\s*["']|\.)[A-Za-z0-9_-]{8,}/g;
const SECRET_NAME = /(?:SECRET|PRIVATE|(?:^|_)KEY$|(?:^|_)PK$|PASSWD|PASSWORD|CREDENTIAL|API_KEY|APIKEY|MNEMONIC|SEED|PHRASE|TOKEN)/i;
const PROTECTED_NAME = /API_KEY|APIKEY|ACCESS_TOKEN|PASSWD|PASSWORD|CREDENTIAL|PHRASE|MNEMONIC|SEED|PRIVATE|PRIV_?KEY|SIGNER_KEY|(?:^|_)SIGNER(?:_|$)|RELAYER_KEY|SECRET|(?:^|_)KEY(?:_|$)|(?:^|_)PK(?:_|$)/i;
const ALWAYS_NAMES = ["RELAYER_PRIVATE_KEY", "ADMIN_SECRET"];
// TOKEN after one of these prefixes is a credential. Other TOKEN names stay
// allowlistable so a public address, symbol, or id can be listed. PK stays its
// own part, so a name such as VITE_UPKEEP_TOKEN is not protected.
const CREDENTIAL_TOKEN_PREFIX = new Set(["ACCESS", "AUTH", "GITHUB", "SESSION"]);
const QUERY_KEY = /^(?:api[_-]?key|apikey|key|access[_-]?key|access[_-]?token|dkey|token|auth|x-api-key)$/i;
const COMMON_USERINFO = new Set(["anonymous", "password", "credentials", "username", "guest"]);

function normalizeName(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
}

function matchesName(re, name) {
  if (re.test(name)) return true;
  const normalized = normalizeName(name);
  return normalized !== name && re.test(normalized);
}

function credentialTokenName(name) {
  const parts = normalizeName(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i].toUpperCase() !== "TOKEN") continue;
    if (CREDENTIAL_TOKEN_PREFIX.has(parts[i - 1].toUpperCase())) return true;
  }
  return false;
}

export function isSecretLikeName(name) {
  return typeof name === "string" && (matchesName(SECRET_NAME, name) || matchesName(PROTECTED_NAME, name));
}

export function isRpcName(name) {
  return name === "RPC_URL" || name.endsWith("_RPC_URL");
}

function isDocsSlug(segment) {
  return /^[a-z]+(?:-[a-z]+)+$/.test(segment);
}

function isKeySegment(segment) {
  if (segment.length < 16) return false;
  if (isDocsSlug(segment)) return false;
  if (/^[0-9a-fA-F]{16,}$/.test(segment)) return true;
  if (/[0-9]/.test(segment) && /[A-Za-z]/.test(segment) && /^[A-Za-z0-9._~-]+$/.test(segment)) {
    return true;
  }
  return false;
}

function isShortAnkrKey(segment) {
  return segment.length >= 8 && segment.length < 16 && /[0-9]/.test(segment) && /^[A-Za-z0-9]+$/.test(segment);
}

function fragmentKeyParts(hash) {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body) return [];
  const found = [];
  const params = new URLSearchParams(body);
  for (const [key, val] of params) {
    if (QUERY_KEY.test(key) && String(val).length >= 12) found.push(String(val));
    if (isKeySegment(val)) found.push(String(val));
    if (isKeySegment(key)) found.push(key);
  }
  for (const segment of body.split(/[/?&]/)) {
    const bare = segment.includes("=") ? segment.slice(segment.indexOf("=") + 1) : segment;
    let decoded = bare;
    try {
      decoded = decodeURIComponent(bare);
    } catch {
      decoded = bare;
    }
    if (isKeySegment(decoded)) found.push(decoded);
  }
  return found;
}

function userinfoCounts(value, password) {
  if (!value || value.length < 8) return false;
  if (COMMON_USERINFO.has(value.toLowerCase())) return false;
  if (/^[0-9a-fA-F]+$/.test(value)) return true;
  if (/[0-9]/.test(value) && /[A-Za-z]/.test(value)) return true;
  if (password) return true;
  return value.length >= 16;
}

function inspectRpc(value) {
  let raw = String(value).trim();
  if (raw.startsWith("//")) raw = `https:${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { keyLike: false, parts: [] };
  }
  if (!/^(?:https?|wss?):$/.test(url.protocol)) return { keyLike: false, parts: [] };
  const parts = [];
  let keyLike = false;
  if (userinfoCounts(url.password, true)) {
    keyLike = true;
    parts.push(url.password);
  }
  if (userinfoCounts(url.username, false)) {
    keyLike = true;
    parts.push(url.username);
  }
  for (const [key, val] of url.searchParams) {
    if (QUERY_KEY.test(key) && String(val).length >= 12) {
      keyLike = true;
      parts.push(String(val));
    }
  }
  const ankrHost = url.hostname.split(".").includes("ankr");
  for (const segment of url.pathname.split("/")) {
    if (!segment) continue;
    if (isKeySegment(segment) || (ankrHost && isShortAnkrKey(segment))) {
      keyLike = true;
      parts.push(segment);
    }
  }
  const fragmentParts = fragmentKeyParts(url.hash);
  if (fragmentParts.length > 0) {
    keyLike = true;
    parts.push(...fragmentParts);
  }
  return { keyLike, parts: [...new Set(parts.filter((part) => part.length >= 8))] };
}

export function isKeyLikeRpc(value) {
  return inspectRpc(value).keyLike;
}

function isRepeatedNibble(body) {
  return /^([0-9a-f])\1{63}$/i.test(body);
}

function positionOf(text, index) {
  if (index < 0) return { line: 1, column: 1 };
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function relTo(root, file) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return file.split(path.sep).join("/");
  return rel.split(path.sep).join("/");
}

function walkFiles(dir) {
  const findings = [];
  if (!dir || !fs.existsSync(dir)) return { files: [], findings };
  let root;
  try {
    root = fs.realpathSync(dir);
  } catch {
    findings.push({ file: dir, line: 1, column: 1, rule: "symlink" });
    return { files: [], findings };
  }
  if (!fs.statSync(root).isDirectory()) return { files: [], findings, root };
  const files = [];
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        let real;
        try {
          real = fs.realpathSync(full);
        } catch {
          findings.push({ file: full, line: 1, column: 1, rule: "symlink" });
          continue;
        }
        const rel = path.relative(root, real);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          findings.push({ file: full, line: 1, column: 1, rule: "symlink" });
          continue;
        }
        if (seen.has(real)) continue;
        seen.add(real);
        const st = fs.statSync(real);
        if (st.isDirectory()) stack.push(real);
        else if (st.isFile()) files.push(real);
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) {
        if (seen.has(full)) continue;
        seen.add(full);
        files.push(full);
      }
    }
  }
  return { files, findings, root };
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

function allowlistHas(options, ...candidates) {
  const list = options.allowlist;
  if (!list || list.size === 0) return false;
  return candidates.some((candidate) => list.has(candidate));
}

function isKnownHex(body, matched, options) {
  const lower = body.toLowerCase();
  if (isRepeatedNibble(lower)) return true;
  if (allowlistHas(options, matched, body)) return true;
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

function addValueVariants(variants, text) {
  variants.add(text);
  const body = hexBody(text);
  if (!body) return;
  variants.add(body);
  variants.add(body.toLowerCase());
  variants.add(body.toUpperCase());
  variants.add(`0x${body}`);
  variants.add(`0x${body.toLowerCase()}`);
  variants.add(`0X${body.toUpperCase()}`);
}

function valueAllowlisted(name, value, options) {
  if (ALWAYS_NAMES.includes(name)) return false;
  if (matchesName(PROTECTED_NAME, name) || credentialTokenName(name)) return false;
  const body = hexBody(value);
  if (isSecretLikeName(name) && body && body.length === 64) return false;
  return allowlistHas(options, value);
}

export function secretMaterial(env = {}, options = {}) {
  const items = [];
  for (const [name, raw] of Object.entries(env)) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length < 8) continue;
    if (/^(?:true|false|yes|no|0|1)$/i.test(value)) continue;
    const secretName = isSecretLikeName(name);
    const rpcName = isRpcName(name);
    const inspected = rpcName ? inspectRpc(value) : { keyLike: false, parts: [] };
    const keyedRpc = inspected.keyLike;
    if (!secretName && !keyedRpc) continue;
    if (!keyedRpc && valueAllowlisted(name, value, options)) continue;
    const variants = new Set();
    addValueVariants(variants, value);
    for (const part of inspected.parts) addValueVariants(variants, part);
    const body = hexBody(value);
    items.push({
      name,
      value,
      hex: Boolean(body),
      fullOnly: keyedRpc,
      keyParts: inspected.parts.filter((part) => part.length >= 16),
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

function namesToFind(env, options) {
  const names = new Set(ALWAYS_NAMES);
  for (const item of secretMaterial(env, options)) names.add(item.name);
  return [...names];
}

function pushFinding(findings, seen, finding) {
  const key = `${finding.file}:${finding.line}:${finding.column ?? 0}:${finding.rule}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

function at(file, text, index, rule) {
  const pos = positionOf(text, index);
  return { file, line: pos.line, column: pos.column, rule };
}

export function bundleShapeFindings(distDir) {
  if (!distDir || !fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    return [{ file: distDir || "dist", line: 1, column: 1, rule: "missing-dist" }];
  }
  const walked = walkFiles(distDir);
  const findings = walked.findings.map((finding) => ({
    ...finding,
    file: relTo(distDir, finding.file),
  }));
  const hasHtml = walked.files.some((file) => path.basename(file) === "index.html");
  const hasJs = walked.files.some((file) => file.endsWith(".js"));
  if (!hasHtml || !hasJs) {
    findings.push({ file: distDir, line: 1, column: 1, rule: "empty-dist" });
  }
  return findings;
}

function indexIn(text, needle, hex) {
  const exact = text.indexOf(needle);
  if (exact >= 0) return exact;
  if (!hex) return -1;
  return text.toLowerCase().indexOf(needle.toLowerCase());
}

function findWindow(text, value, hex) {
  if (value.length < 16) return -1;
  const hay = hex ? text.toLowerCase() : text;
  const needle = hex ? value.toLowerCase() : value;
  for (let i = 0; i + 16 <= needle.length; i += 1) {
    const index = hay.indexOf(needle.slice(i, i + 16));
    if (index >= 0) return index;
  }
  return -1;
}

let bip39Index;

function bip39Indexes() {
  if (bip39Index) return bip39Index;
  const words = fs.readFileSync(WORDLIST_FILE, "utf8").trim().split(/\s+/);
  if (words.length !== 2048) throw new Error("BIP39 english wordlist must contain 2048 words");
  bip39Index = new Map(words.map((word, index) => [word, index]));
  return bip39Index;
}

function phraseChecksumOk(indexes) {
  const checksumBits = indexes.length / 3;
  if (!Number.isInteger(checksumBits)) return false;
  let bits = "";
  for (const index of indexes) bits += index.toString(2).padStart(11, "0");
  const entropyBits = bits.slice(0, bits.length - checksumBits);
  const checksum = bits.slice(bits.length - checksumBits);
  if (entropyBits.length % 8 !== 0) return false;
  const entropy = Buffer.alloc(entropyBits.length / 8);
  for (let i = 0; i < entropy.length; i += 1) {
    entropy[i] = Number.parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  }
  const hash = createHash("sha256").update(entropy).digest();
  let hashBits = "";
  for (const byte of hash) hashBits += byte.toString(2).padStart(8, "0");
  return hashBits.startsWith(checksum);
}

function mnemonicWindow(parts) {
  if (parts.length < 12) return -1;
  for (const size of PHRASE_LENGTHS) {
    if (parts.length < size) continue;
    for (let i = 0; i + size <= parts.length; i += 1) {
      const window = parts.slice(i, i + size);
      if (phraseChecksumOk(window.map((part) => part.wordIndex))) return window[0].at;
    }
  }
  return -1;
}

function mnemonicSource(text) {
  let out = "";
  const map = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 92 && i + 1 < text.length && "ntr".includes(text[i + 1])) {
      out += " ";
      map.push(i);
      i += 1;
      continue;
    }
    out += text[i];
    map.push(i);
  }
  return { text: out, map };
}

function mnemonicIndex(text) {
  const source = mnemonicSource(text);
  const indexes = bip39Indexes();
  const re = /(?<![A-Za-z])[A-Za-z]{3,8}(?![A-Za-z])/g;
  const gapOk = /^[\s,\[\]"'`\\]+$/;
  const parts = [];
  let end = -1;
  const flush = () => {
    const hit = mnemonicWindow(parts);
    parts.length = 0;
    return hit;
  };
  for (const match of source.text.matchAll(re)) {
    if (end >= 0 && !gapOk.test(source.text.slice(end, match.index))) {
      const hit = flush();
      if (hit >= 0) return source.map[hit];
    }
    end = match.index + match[0].length;
    const wordIndex = indexes.get(match[0].toLowerCase());
    if (wordIndex === undefined) {
      const hit = flush();
      if (hit >= 0) return source.map[hit];
      continue;
    }
    parts.push({ wordIndex, at: match.index });
  }
  const hit = flush();
  return hit >= 0 ? source.map[hit] : -1;
}

function contentFindings(file, text, options, secrets) {
  const findings = [];
  const seen = new Set();
  const map = file.endsWith(".map");
  if (!map) {
    for (const name of options.names) {
      const index = boundedName(text, name);
      if (index < 0) continue;
      pushFinding(findings, seen, at(file, text, index, ruleForName(name)));
    }
    RELAYER_NAME.lastIndex = 0;
    for (const match of text.matchAll(RELAYER_NAME)) {
      if (allowlistHas(options, match[0])) continue;
      pushFinding(findings, seen, at(file, text, match.index, "relayer-env-key"));
    }
  }

  HEX64.lastIndex = 0;
  for (const match of text.matchAll(HEX64)) {
    if (isKnownHex(match[1], match[0], options)) continue;
    pushFinding(findings, seen, at(file, text, match.index, "hex64"));
  }

  const urlRe = /(?:(?:https?|wss?):\/\/|(?<![A-Za-z0-9:])\/\/)[^\s"'<>`]+/gi;
  for (const match of text.matchAll(urlRe)) {
    const candidate = match[0].replace(/[),.;]+$/, "");
    if (!isKeyLikeRpc(candidate)) continue;
    if (allowlistHas(options, candidate) && !isKeyedProviderUrl(candidate)) continue;
    pushFinding(findings, seen, at(file, text, match.index, "rpc-url"));
  }

  const phraseAt = mnemonicIndex(text);
  if (phraseAt >= 0) pushFinding(findings, seen, at(file, text, phraseAt, "mnemonic"));

  for (const re of [JWT, JWT_DOT_JOIN]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      pushFinding(findings, seen, at(file, text, match.index, "jwt"));
    }
  }

  for (const secret of secrets) {
    let rawIndex = -1;
    for (const variant of secret.variants) {
      const index = indexIn(text, variant, secret.hex);
      if (index >= 0) {
        rawIndex = index;
        break;
      }
    }
    if (rawIndex >= 0) pushFinding(findings, seen, at(file, text, rawIndex, "forbidden-value"));
    for (const encoded of secret.encodings) {
      const index = text.indexOf(encoded);
      if (index < 0) continue;
      pushFinding(findings, seen, at(file, text, index, "forbidden-encoding"));
    }
  }
  return findings;
}

/**
 * @returns {{ file: string, line: number, column: number, rule: string }[]}
 */
export function scanDist(distDir, options = {}) {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) return [];
  const findings = [];
  const seen = new Set();
  const env = options.env ?? {};
  const secrets = secretMaterial(env, options);
  const names = namesToFind(env, options);
  const walked = walkFiles(distDir);
  const reportRoot = walked.root ?? distDir;
  for (const finding of walked.findings) {
    pushFinding(findings, seen, { ...finding, file: relTo(reportRoot, finding.file) });
  }
  const loaded = walked.files.map((file) => ({
    file,
    rel: relTo(reportRoot, file),
    text: readText(file),
  }));

  for (const entry of loaded) {
    for (const finding of contentFindings(entry.rel, entry.text, { ...options, names }, secrets)) {
      pushFinding(findings, seen, finding);
    }
  }

  for (const secret of secrets) {
    const windows = secret.fullOnly ? secret.keyParts : secret.variants;
    if (windows.length === 0) continue;
    const present = loaded.some((entry) =>
      secret.variants.some((variant) => indexIn(entry.text, variant, secret.hex) >= 0),
    );
    if (present) continue;
    let hit = null;
    for (const entry of loaded) {
      for (const variant of windows) {
        const asHex = secret.fullOnly ? /^[0-9a-fA-F]+$/.test(variant) : secret.hex;
        const value = asHex ? variant.replace(/^0x/i, "") : variant;
        const index = findWindow(entry.text, value, asHex);
        if (index < 0) continue;
        hit = { entry, index };
        break;
      }
      if (hit) break;
    }
    if (!hit) continue;
    pushFinding(findings, seen, at(hit.entry.rel, hit.entry.text, hit.index, "forbidden-split"));
  }

  return findings;
}

let pinnedChecksum;

function pinnedChecksumValue() {
  if (pinnedChecksum !== undefined) return pinnedChecksum;
  const text = fs.readFileSync(CHECKSUM_FILE, "utf8");
  const match = text.match(/^\s*GITLEAKS_SHA256=([0-9a-fA-F]{64})\s*$/m);
  pinnedChecksum = match ? match[1].toLowerCase() : "";
  return pinnedChecksum;
}

export function checksumMatchExempt(file, lineText, matchIndex, body) {
  if (path.resolve(file) !== CHECKSUM_FILE) return false;
  if (String(body).toLowerCase() !== pinnedChecksumValue()) return false;
  const before = lineText.slice(0, matchIndex);
  return /^\s*GITLEAKS_SHA256=$/.test(before);
}

function isUnbundledTest(file) {
  return /\.test\.tsx?$/.test(path.basename(file));
}

function literalAllowlist(file, options) {
  if (!isUnbundledTest(file)) return options.allowlist;
  return options.placeholderAllowlist ?? new Set();
}

export function scanHexText(file, text, options = {}) {
  const findings = [];
  const seen = new Set();
  const scoped = { ...options, allowlist: literalAllowlist(file, options) };
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    HEX64.lastIndex = 0;
    for (const match of lineText.matchAll(HEX64)) {
      if (checksumMatchExempt(file, lineText, match.index, match[1])) continue;
      if (isRepeatedNibble(match[1])) continue;
      if (allowlistHas(scoped, match[0], match[1])) continue;
      pushFinding(findings, seen, {
        file,
        line: i + 1,
        column: match.index + 1,
        rule: "hex64-literal",
      });
    }
    for (const re of [JWT, JWT_DOT_JOIN]) {
      re.lastIndex = 0;
      for (const match of lineText.matchAll(re)) {
        pushFinding(findings, seen, {
          file,
          line: i + 1,
          column: match.index + 1,
          rule: "jwt",
        });
      }
    }
  }
  const phraseAt = mnemonicIndex(text);
  if (phraseAt >= 0) {
    pushFinding(findings, seen, { ...at(file, text, phraseAt, "mnemonic") });
  }
  return findings;
}

export function scanHexLiterals(targets, options = {}) {
  const files = [];
  const findings = [];
  const seen = new Set();
  for (const target of targets) {
    if (!target || !fs.existsSync(target)) continue;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(target);
      } catch {
        pushFinding(findings, seen, { file: target, line: 1, column: 1, rule: "symlink" });
        continue;
      }
      const base = path.dirname(path.resolve(target));
      const rel = path.relative(base, real);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        pushFinding(findings, seen, { file: target, line: 1, column: 1, rule: "symlink" });
        continue;
      }
    }
    if (fs.statSync(target).isDirectory()) {
      const walked = walkFiles(target);
      for (const finding of walked.findings) pushFinding(findings, seen, finding);
      files.push(...walked.files);
    } else if (fs.statSync(target).isFile()) {
      files.push(target);
    }
  }
  for (const file of files) {
    for (const finding of scanHexText(file, readText(file), options)) {
      pushFinding(findings, seen, finding);
    }
  }
  return findings;
}

function isPublicQuerySlug(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(value)) return false;
  return /[g-z]/i.test(value);
}

function isExplorerTxHash(pathname, segment) {
  if (!/\/tx\//i.test(pathname)) return false;
  const body = String(segment).replace(/^0x/i, "");
  return /^[0-9a-fA-F]{40,64}$/.test(body);
}

function isKeyedProviderUrl(value) {
  if (!isKeyLikeRpc(value)) return false;
  let raw = String(value).trim();
  if (raw.startsWith("//")) raw = `https:${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (userinfoCounts(url.password, true) || userinfoCounts(url.username, false)) return true;
  if (fragmentKeyParts(url.hash).length > 0) return true;
  const ankrHost = url.hostname.split(".").includes("ankr");
  for (const segment of url.pathname.split("/")) {
    if (!segment) continue;
    if (!(isKeySegment(segment) || (ankrHost && isShortAnkrKey(segment)))) continue;
    if (isExplorerTxHash(url.pathname, segment)) continue;
    return true;
  }
  for (const [key, val] of url.searchParams) {
    if (!QUERY_KEY.test(key) || String(val).length < 12) continue;
    if (isPublicQuerySlug(val)) continue;
    return true;
  }
  return false;
}

export function parseAllowlist(text, file = "secretScanAllowlist.txt") {
  const values = new Set();
  const errors = [];
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(\S+)\s+#\s*(\S.*)$/.exec(line);
    const entry = match ? match[1] : "";
    const queryUrl = /^(?:https?|wss?):\/\//i.test(entry);
    if (!match || entry.includes("*") || (!queryUrl && entry.includes("?"))) {
      errors.push({ file, line: i + 1, column: 1, rule: "allowlist" });
      continue;
    }
    if (isKeyedProviderUrl(match[1])) {
      errors.push({
        file,
        line: i + 1,
        column: 1,
        rule: "allowlist",
        detail: "keyed provider URL",
      });
      continue;
    }
    values.add(match[1]);
  }
  return { values, errors };
}

function loadAllowlistFile(file) {
  const label = path.basename(file);
  if (!fs.existsSync(file)) {
    return {
      values: new Set(),
      errors: [{ file: label, line: 1, column: 1, rule: "allowlist" }],
    };
  }
  return parseAllowlist(fs.readFileSync(file, "utf8"), label);
}

export function formatFinding(finding) {
  const column = finding.column ? `:${finding.column}` : "";
  const detail = finding.detail ? ` ${finding.detail}` : "";
  return `${finding.file}:${finding.line}${column} ${finding.rule}${detail}`;
}

function defaultKnownRoots() {
  const root = path.join(scriptDir, "node_modules");
  return fs.existsSync(root) ? [root] : [];
}

function defaultLiteralTargets() {
  return [
    path.join(scriptDir, "src"),
    path.resolve(scriptDir, "../shared"),
    CHECKSUM_FILE,
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

export function registerSigtermGuard() {
  process.once("SIGTERM", () => {
    process.stderr.write("bundle secret check interrupted\n");
    process.exit(143);
  });
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { distDir, roots, sawRoot } = parseArgs(argv);
  if (!distDir) {
    process.stderr.write("usage: node checkDistSecrets.mjs <dist> [--root dir]\n");
    return 2;
  }
  const knownRoots = sawRoot ? roots : defaultKnownRoots();
  const allowlist = loadAllowlistFile(ALLOWLIST_FILE);
  const placeholder = loadAllowlistFile(PLACEHOLDER_ALLOWLIST_FILE);
  const findings = [];
  const seen = new Set();
  for (const finding of [
    ...allowlist.errors,
    ...placeholder.errors,
    ...bundleShapeFindings(distDir),
    ...scanDist(distDir, { env, knownRoots, allowlist: allowlist.values }),
    ...scanHexLiterals(defaultLiteralTargets(), {
      allowlist: allowlist.values,
      placeholderAllowlist: placeholder.values,
    }),
  ]) {
    pushFinding(findings, seen, finding);
  }
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
  registerSigtermGuard();
  process.exit(main());
}
