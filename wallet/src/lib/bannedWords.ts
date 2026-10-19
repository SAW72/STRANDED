/** Stems that must not appear in user-facing copy, including ordinary inflections. */
export const BANNED_STEMS = [
  "invest",
  "earn",
  "reward",
  "airdrop",
  "presale",
  "price",
  "listing",
  "apy",
  "profit",
  "trade",
  "value",
] as const;

export type BannedHit = {
  stem: string;
  match: string;
  excerpt: string;
  file: string;
};

const FORM_TO_STEM = new Map<string, string>();

function addForm(stem: string, form: string) {
  const key = form.toLowerCase();
  if (!FORM_TO_STEM.has(key)) FORM_TO_STEM.set(key, stem);
}

for (const stem of BANNED_STEMS) {
  addForm(stem, stem);
  addForm(stem, `${stem}s`);
  addForm(stem, `${stem}es`);
  addForm(stem, `${stem}ed`);
  addForm(stem, `${stem}ing`);
  if (stem.endsWith("e")) {
    const base = stem.slice(0, -1);
    addForm(stem, `${base}ed`);
    addForm(stem, `${base}ing`);
    addForm(stem, `${stem}d`);
  } else {
    const last = stem.slice(-1);
    if (/[bcdfghjklmnpqrstvwxyz]/.test(last)) {
      addForm(stem, `${stem}${last}ed`);
      addForm(stem, `${stem}${last}ing`);
    }
  }
}

// earn* is the stem plus these suffixes only. earnest, learn, yearn, and unearned stay clean.
addForm("earn", "earnings");
addForm("invest", "investment");
addForm("invest", "investments");
addForm("invest", "investor");
addForm("invest", "investors");
addForm("trade", "trader");
addForm("trade", "traders");
addForm("trade", "tradable");
addForm("value", "valuable");
addForm("profit", "profitable");
addForm("profit", "profitability");
addForm("listing", "listed");
addForm("trade", "tradeable");

const FORMS_LONGEST_FIRST = [...FORM_TO_STEM.keys()].sort((a, b) => b.length - a.length);
// Hyphens and underscores split tokens. A second pass joins each run so air-drop matches.
const BANNED_PATTERN = new RegExp(
  `(?<![A-Za-z0-9])(?:${FORMS_LONGEST_FIRST.map(escapeRegExp).join("|")})(?![A-Za-z0-9])`,
  "gi",
);

// Default_Ignorable covers the soft hyphen, CGJ, bidi marks, function application, and variation selectors.
const IGNORABLE = /[\u180E\p{Default_Ignorable_Code_Point}]/gu;
// ASCII hyphen, the dashes from the first pass, the remaining Unicode dashes, and underscore.
const HYPHEN_SOURCE =
  "\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\uFE58\\uFE63\\uFF0D\\u058A\\u05BE\\u1806\\u2043\\u2E17\\u2E1A\\u2E3A\\u2E3B\\u301C\\u30A0_";
const HYPHEN_RUN = new RegExp(`[A-Za-z0-9]+(?:[${HYPHEN_SOURCE}][A-Za-z0-9]+)+`, "gu");
const ALLOWED_COMPOUNDS = ["trade-off", "data-value", "price_id"];

/** True when the whole literal is a banned form, with no punctuation stripped. */
export function isWholeBannedForm(text: string): boolean {
  return FORM_TO_STEM.has(text.trim().toLowerCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatBannedHits(hits: BannedHit[]): string {
  return hits
    .map((hit) => `${hit.file}: "${hit.excerpt}" matched ${hit.stem} (${hit.match})`)
    .join("\n");
}

function buildRoots(): string[] {
  const proc = (globalThis as { process?: { cwd?: () => string; env?: Record<string, string | undefined> } }).process;
  const roots = [proc?.cwd?.(), proc?.env?.TMPDIR, proc?.env?.TEMP, proc?.env?.TMP, "/tmp"];
  const found: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    const norm = root.replaceAll("\\", "/").replace(/\/+$/, "");
    if (norm && !found.includes(norm)) found.push(norm);
  }
  return found;
}

/**
 * A genuine build path: an absolute path under this checkout, the temp dir, or
 * /tmp, or a node_modules segment that ends in a file extension.
 * Slash-separated copy is not a path.
 */
export function isAbsoluteBuildPath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  const norm = trimmed.replaceAll("\\", "/");
  if (/(?:^|\/)node_modules\/.+\.[A-Za-z0-9]+$/.test(norm)) return true;
  if (!norm.startsWith("/")) return false;
  return buildRoots().some((root) => norm === root || norm.startsWith(`${root}/`));
}

function normalizeCopy(text: string): string {
  return text.replace(IGNORABLE, "").normalize("NFKC");
}

function maskBuildPaths(text: string): string {
  return text.replace(/(?:\/|[A-Za-z]:[\\/])[^\s"'`<>)]+/g, (candidate) =>
    isAbsoluteBuildPath(candidate) ? " ".repeat(candidate.length) : candidate,
  );
}

function maskAllowedCompounds(text: string): string {
  let next = text;
  for (const compound of ALLOWED_COMPOUNDS) {
    const pattern = new RegExp(compound.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    next = next.replace(pattern, (match) => " ".repeat(match.length));
  }
  return next;
}

/** Same-length rewrite so match indexes still point at the original text. */
function prepareCopy(text: string): string {
  const split = maskAllowedCompounds(maskBuildPaths(normalizeCopy(text)))
    .replace(new RegExp(`\\bpre[${HYPHEN_SOURCE} ]sales\\b`, "gi"), "presales ")
    .replace(new RegExp(`\\bpre[${HYPHEN_SOURCE} ]sale\\b`, "gi"), "presale ")
    .replace(new RegExp(`[${HYPHEN_SOURCE}]`, "g"), " ");
  return split
    .replace(/\bno\s+cash\s+value\b/gi, (match) => " ".repeat(match.length))
    .replace(/\bno\s+value\b/gi, (match) => " ".repeat(match.length))
    .replace(/[^A-Za-z0-9\s']/g, " ");
}

function hitsOnPrepared(prepared: string, excerptFrom: string, file: string): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const match of prepared.matchAll(BANNED_PATTERN)) {
    const word = match[0];
    const stem = FORM_TO_STEM.get(word.toLowerCase()) ?? word.toLowerCase();
    const index = match.index ?? 0;
    const excerpt = excerptFrom
      .slice(Math.max(0, index - 48), Math.min(excerptFrom.length, index + word.length + 48))
      .replace(/\s+/g, " ")
      .trim();
    hits.push({ stem, match: word, excerpt, file });
  }
  return hits;
}

function remember(hits: BannedHit[], next: BannedHit[]) {
  for (const hit of next) {
    const seen = hits.some(
      (item) => item.stem === hit.stem && item.excerpt === hit.excerpt && item.file === hit.file,
    );
    if (!seen) hits.push(hit);
  }
}

export function bannedHitsInText(text: string, file: string): BannedHit[] {
  if (isAbsoluteBuildPath(text)) return [];
  const hits: BannedHit[] = [];
  remember(hits, hitsOnPrepared(prepareCopy(text), text, file));
  const normalized = normalizeCopy(text);
  for (const run of normalized.matchAll(HYPHEN_RUN)) {
    const collapsed = run[0].replace(new RegExp(`[${HYPHEN_SOURCE}]`, "g"), "");
    const prepared = prepareCopy(collapsed);
    for (const hit of hitsOnPrepared(prepared, run[0], file)) {
      remember(hits, [{ ...hit, excerpt: run[0] }]);
    }
  }
  return hits;
}

export type RedirectHit = { file: string; line: string; target: string };

/** A site path. Rejects protocol-relative, backslash, placeholder, and encoded-slash targets. */
export function redirectTargetAllowed(target: string): boolean {
  if (/%2f|%5c/i.test(target)) return false;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return false;
  }
  if (!decoded.startsWith("/")) return false;
  if (decoded.startsWith("//") || decoded.startsWith("/\\") || decoded.startsWith("/:")) return false;
  if (decoded.includes("\\")) return false;
  return true;
}

/** Every `_redirects` target must be a site path. An external 302 is a hit. */
export function unsafeRedirects(text: string, file: string): RedirectHit[] {
  const hits: RedirectHit[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const target = parts[1];
    if (!target || redirectTargetAllowed(target)) continue;
    hits.push({ file, line: trimmed, target });
  }
  return hits;
}

export function bannedWordsIn(text: string): string[] {
  const stems: string[] = [];
  for (const hit of bannedHitsInText(text, "")) {
    if (!stems.includes(hit.stem)) stems.push(hit.stem);
  }
  return stems;
}

/** Join adjacent quoted literals (`"air" + "drop"`). Runtime joins are left alone. */
export function foldConcatenatedStrings(code: string): string {
  const pair = /(["'])([^"'\\\n]{0,200})\1\s*\+\s*(["'])([^"'\\\n]{0,200})\3/g;
  let current = code;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(pair, (_match, quote: string, left: string, _rightQuote: string, right: string) => {
      return `${quote}${left}${right}${quote}`;
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

export type CodeLiteral = { text: string; index: number };

export function extractStringLiterals(code: string): CodeLiteral[] {
  const found: CodeLiteral[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const quote = code[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    let j = i + 1;
    let text = "";
    let closed = false;
    while (j < code.length) {
      const char = code[j];
      if (char === "\\") {
        const next = code[j + 1];
        if (next === "n") text += "\n";
        else if (next === "t") text += "\t";
        else if (next === "x" && /^[0-9A-Fa-f]{2}/.test(code.slice(j + 2, j + 4))) {
          text += String.fromCharCode(Number.parseInt(code.slice(j + 2, j + 4), 16));
          j += 4;
          continue;
        } else if (next === "u" && code[j + 2] === "{") {
          const end = code.indexOf("}", j + 3);
          const hex = end === -1 ? "" : code.slice(j + 3, end);
          if (/^[0-9A-Fa-f]{1,6}$/.test(hex)) {
            text += String.fromCodePoint(Number.parseInt(hex, 16));
            j = end + 1;
            continue;
          }
          text += next;
        } else if (next === "u" && /^[0-9A-Fa-f]{4}/.test(code.slice(j + 2, j + 6))) {
          text += String.fromCharCode(Number.parseInt(code.slice(j + 2, j + 6), 16));
          j += 6;
          continue;
        } else if (next !== undefined) text += next;
        j += 2;
        continue;
      }
      if (quote === "`" && char === "$" && code[j + 1] === "{") {
        if (text) found.push({ text, index: i });
        text = "";
        j += 2;
        let depth = 1;
        while (j < code.length && depth > 0) {
          if (code[j] === "{") depth += 1;
          else if (code[j] === "}") depth -= 1;
          j += 1;
        }
        continue;
      }
      if (char === quote) {
        closed = true;
        j += 1;
        break;
      }
      text += char;
      j += 1;
    }
    if (closed && text) found.push({ text, index: i });
    i = j - 1;
  }
  return found;
}

/**
 * Scan every string literal, including one-word labels and JSX {"..."} expressions.
 * Punctuation is split off before matching. A bare "value" next to the permit
 * `uint256` field is the EIP-712 type name, not copy.
 */
export function hitsInAppCode(code: string, file: string): BannedHit[] {
  const folded = foldConcatenatedStrings(code);
  const hits: BannedHit[] = [];
  for (const literal of extractStringLiterals(folded)) {
    const trimmed = literal.text.trim();
    if (!trimmed) continue;
    if (isAbsoluteBuildPath(trimmed)) continue;
    if (trimmed.toLowerCase() === "value") {
      const around = folded.slice(Math.max(0, literal.index - 48), Math.min(folded.length, literal.index + 48));
      if (/uint256/.test(around)) continue;
    }
    hits.push(...bannedHitsInText(trimmed, file));
  }
  return hits;
}

/** CSS `content:` values and custom-property strings. `justify-content` is not the content property. */
export function cssContentHits(css: string, file: string): BannedHit[] {
  const hits: BannedHit[] = [];
  const patterns = [
    /(?<![\w-])content\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g,
    /--[\w-]+\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g,
  ];
  for (const pattern of patterns) {
    for (const match of css.matchAll(pattern)) {
      const text = (match[1] ?? match[2] ?? "").replace(/\\(["'])/g, "$1");
      if (text) hits.push(...bannedHitsInText(text, file));
    }
  }
  return hits;
}
