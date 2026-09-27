import { collapseWhitespace } from "../utils/text";

// Parses pasted highlights (Kindle "My Clippings", Kindle notebook exports, PDF notes or plain
// excerpts separated by blank lines) into passages with optional notes.

const KINDLE_SEPARATOR = /^={5,}\s*$/m;
const KINDLE_META = /^-?\s*your\s+(highlight|note|bookmark)/i;
const METADATA_LINE =
  /^(?:-\s*)?(?:your\s+)?(?:highlight|note|bookmark|clip)\b.*(?:location|page|loc\.|added on)|^(?:highlight|note)\s*\(\w+\)\s*[|·-]|^(?:page|location|loc\.)\s*[:\d]/i;
const NOTE_PREFIX = /^(?:note|my note|comment)\s*[:—-]\s*/i;

export interface PastedPassage {
  text: string;
  note: string | null;
}

/** Kindle "My Clippings.txt": clips separated by "==========", each "Title\n- Your Highlight|Note …\n\ntext". */
function parseKindleClippings(normalized: string): PastedPassage[] {
  const passages: PastedPassage[] = [];
  for (const clip of normalized.split(KINDLE_SEPARATOR)) {
    const lines = clip.split("\n").map((l) => l.trim());
    const metaIdx = lines.findIndex((l) => KINDLE_META.test(l));
    if (metaIdx === -1) continue;
    const kind = KINDLE_META.exec(lines[metaIdx])![1].toLowerCase();
    const text = collapseWhitespace(lines.slice(metaIdx + 1).join(" "));
    if (!text || kind === "bookmark") continue;
    if (kind === "note") {
      const prev = passages[passages.length - 1];
      if (prev) prev.note = prev.note ? `${prev.note} ${text}` : text;
    } else {
      passages.push({ text, note: null });
    }
  }
  return passages;
}

function parseBlocks(normalized: string): PastedPassage[] {
  const blocks: string[][] = [[]];
  for (const line of normalized.split("\n")) {
    if (/^\s*[-*_=]{3,}\s*$/.test(line) || line.trim() === "") {
      if (blocks[blocks.length - 1].length) blocks.push([]);
    } else {
      blocks[blocks.length - 1].push(line);
    }
  }

  const passages: PastedPassage[] = [];
  for (const block of blocks) {
    const lines = block.map((l) => l.trim()).filter((l) => l && !METADATA_LINE.test(l));
    if (!lines.length) continue;
    const noteIdx = lines.findIndex((l) => NOTE_PREFIX.test(l));
    if (noteIdx === 0) {
      const note = collapseWhitespace(lines.join(" ").replace(NOTE_PREFIX, ""));
      const prev = passages[passages.length - 1];
      if (prev) prev.note = prev.note ? `${prev.note} ${note}` : note;
      continue;
    }
    const textLines = noteIdx > 0 ? lines.slice(0, noteIdx) : lines;
    const note = noteIdx > 0 ? collapseWhitespace(lines.slice(noteIdx).join(" ").replace(NOTE_PREFIX, "")) : null;
    const text = collapseWhitespace(textLines.join(" ").replace(/^[•*-]\s+/, "").replace(/^["“](.*)["”]$/, "$1"));
    if (text.length >= 3) passages.push({ text, note });
  }
  return passages;
}

/** Kindle clippings repeat when a highlight is edited; keep one copy (merging notes). */
function dedupe(passages: PastedPassage[]): PastedPassage[] {
  const byText = new Map<string, PastedPassage>();
  for (const p of passages) {
    const existing = byText.get(p.text);
    if (!existing) byText.set(p.text, { ...p });
    else if (p.note && !existing.note) existing.note = p.note;
  }
  return [...byText.values()];
}

export function parsePastedHighlights(raw: string): PastedPassage[] {
  const normalized = raw.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const isKindle = KINDLE_SEPARATOR.test(normalized) && /your\s+(highlight|note)/i.test(normalized);
  return dedupe(isKindle ? parseKindleClippings(normalized) : parseBlocks(normalized));
}
