export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Length-preserving normalisation for fuzzy matching: folds case, typographic quotes and
 * dashes. Each input char maps to exactly one output char so offsets stay valid.
 */
export function looseChars(text: string): string {
  let out = "";
  for (const ch of text) {
    let c = ch;
    if (c === "‘" || c === "’" || c === "ʼ" || c === "′") c = "'";
    else if (c === "“" || c === "”" || c === "″") c = '"';
    else if (c === "–" || c === "—" || c === "‒" || c === "−") c = "-";
    else if (c === " ") c = " ";
    else {
      const lower = c.toLowerCase();
      if (lower.length === c.length) c = lower;
    }
    out += c;
  }
  return out;
}

const STOPWORDS = new Set(
  "a an the and or but of to in on at for from by with as is are was were be been being it its this that these those which who whom what why how when where does do did can could would should may might must will shall not no than then so such into about over under between their there they them he she his her we our you your i me my".split(
    " ",
  ),
);

/** Lower-cased content words (stopwords removed, crude plural stripping). */
export function contentWords(text: string): string[] {
  const words = looseChars(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function slugify(text: string, maxLength = 40): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/**
 * Whether an excerpt the model attributes to the source can actually be found there.
 * Accepts exact (loosely normalised) containment, or strong overlap of 4-word shingles
 * to tolerate small elisions and punctuation differences.
 */
export function isExcerptGrounded(excerpt: string, sourceText: string): boolean {
  const ex = collapseWhitespace(looseChars(excerpt)).replace(/^["'.…\s]+|["'.…\s]+$/g, "");
  if (ex.length < 8) return false;
  const src = collapseWhitespace(looseChars(sourceText));
  if (src.includes(ex)) return true;
  const exWords = ex.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (exWords.length < 4) return false;
  const srcWords = src.match(/[\p{L}\p{N}]+/gu) ?? [];
  const srcShingles = new Set<string>();
  for (let i = 0; i + 4 <= srcWords.length; i++) srcShingles.add(srcWords.slice(i, i + 4).join(" "));
  let total = 0;
  let hit = 0;
  for (let i = 0; i + 4 <= exWords.length; i++) {
    total++;
    if (srcShingles.has(exWords.slice(i, i + 4).join(" "))) hit++;
  }
  return total > 0 && hit / total >= 0.7;
}
