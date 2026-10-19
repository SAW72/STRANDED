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
addForm("listing", "listed");

const FORMS_LONGEST_FIRST = [...FORM_TO_STEM.keys()].sort((a, b) => b.length - a.length);
// Hyphen joins identifier parts, so a class such as review-value is one token.
const BANNED_PATTERN = new RegExp(
  `(?<![A-Za-z0-9-])(?:${FORMS_LONGEST_FIRST.map(escapeRegExp).join("|")})(?![A-Za-z0-9-])`,
  "gi",
);

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

/** Same-length rewrite so match indexes still point at the original text. */
function prepareCopy(text: string): string {
  return text
    .replace(/\bno cash value\b/gi, (match) => " ".repeat(match.length))
    .replace(/\bno value\b/gi, (match) => " ".repeat(match.length))
    .replace(/\bpre-sales\b/gi, "presales ")
    .replace(/\bpre sales\b/gi, "presales ")
    .replace(/\bpre-sale\b/gi, "presale  ")
    .replace(/\bpre sale\b/gi, "presale ")
    .replace(/[^A-Za-z0-9\s'-]/g, " ");
}

export function bannedHitsInText(text: string, file: string): BannedHit[] {
  const prepared = prepareCopy(text);
  const hits: BannedHit[] = [];
  for (const match of prepared.matchAll(BANNED_PATTERN)) {
    const word = match[0];
    const stem = FORM_TO_STEM.get(word.toLowerCase()) ?? word.toLowerCase();
    const index = match.index ?? 0;
    const excerpt = text
      .slice(Math.max(0, index - 48), Math.min(text.length, index + word.length + 48))
      .replace(/\s+/g, " ")
      .trim();
    hits.push({ stem, match: word, excerpt, file });
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
        else if (next !== undefined) text += next;
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
    if (trimmed.toLowerCase() === "value") {
      const around = folded.slice(Math.max(0, literal.index - 48), Math.min(folded.length, literal.index + 48));
      if (/uint256/.test(around)) continue;
    }
    hits.push(...bannedHitsInText(trimmed, file));
  }
  return hits;
}

/** CSS `content:` values. `justify-content` is not the content property. */
export function cssContentHits(css: string, file: string): BannedHit[] {
  const hits: BannedHit[] = [];
  const pattern = /(?<![\w-])content\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
  for (const match of css.matchAll(pattern)) {
    const text = (match[1] ?? match[2] ?? "").replace(/\\(["'])/g, "$1");
    if (text) hits.push(...bannedHitsInText(text, file));
  }
  return hits;
}
