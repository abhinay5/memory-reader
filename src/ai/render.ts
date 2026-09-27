import type { Highlight, Idea, OutlineSection, Source } from "../types";
import { truncate } from "../utils/text";

// Renders local data into the tagged plain-text format the prompts expect.
// Ids are replaced with short aliases (h1, i1, c1) which the model handles more reliably.

export const FULL_TEXT_LIMIT = 180_000; // chars (~45k tokens) before switching to section digests
export const DIGEST_CHUNK_CHARS = 60_000;
/** Beyond this (roughly a long book), whole-source analysis is refused; highlights are used instead. */
export const DIGEST_LIMIT = 600_000;
const MAX_OUTLINE_HEADINGS = 60;

export function esc(text: string): string {
  // Keep the model from confusing source text with our structural tags.
  return text.replace(/<(\/?)(source|article|highlights?|idea|ideas|card|cards|existing_cards|section|task|retry_note)\b/gi, "‹$1$2");
}

function attr(text: string): string {
  return esc(text).replace(/"/g, "'");
}

export function renderSourceMeta(source: Source): string {
  const lines = [`title: ${esc(source.title)}`];
  if (source.author) lines.push(`author: ${esc(source.author)}`);
  if (source.site) lines.push(`publication: ${esc(source.site)}`);
  if (source.url) lines.push(`url: ${source.url}`);
  lines.push(
    `kind: ${source.sourceType === "web_article" ? "web article" : source.sourceType === "pasted_highlights" ? "highlights pasted by the reader (book, PDF or article)" : "pasted text"}`,
  );
  return `<source>\n${lines.join("\n")}\n</source>`;
}

export function sectionText(section: OutlineSection): string {
  const heading = section.heading ? `${"#".repeat(Math.max(2, section.level))} ${section.heading}\n\n` : "";
  return heading + section.paragraphs.join("\n\n");
}

export function renderFullArticle(source: Source): string {
  const body = source.outline.length ? source.outline.map(sectionText).join("\n\n") : source.extractedText;
  return `<article>\n${esc(body)}\n</article>`;
}

export function renderOutline(source: Source): string {
  const headings = source.outline.filter((s) => s.heading).slice(0, MAX_OUTLINE_HEADINGS).map((s) => `${"  ".repeat(Math.max(0, s.level - 2))}- ${esc(s.heading!)}`);
  return headings.length ? `<article_outline>\n${headings.join("\n")}\n</article_outline>` : "";
}

export function withNeighbours(sections: Set<number>, count: number): Set<number> {
  const out = new Set<number>();
  for (const i of sections) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < count) out.add(j);
  return out;
}

/** Long sources with highlights: the highlighted sections (and their neighbours) in full, the rest omitted. */
export function renderFocusedArticle(source: Source, focusSections: Set<number>): string {
  const parts = [...focusSections]
    .sort((a, b) => a - b)
    .map((i) => {
      const section = source.outline[i];
      const heading = section.heading ? ` heading="${attr(section.heading)}"` : "";
      return `<section index="${i}"${heading}>\n${esc(section.paragraphs.join("\n\n"))}\n</section>`;
    });
  return `${renderOutline(source)}\n\n<article note="This source is long; only the sections around the reader's highlights are included.">\n${parts.join("\n\n")}\n</article>`;
}

/** Long sources: full text for sections the reader highlighted, digests for the rest. */
export function renderHierarchicalArticle(source: Source, digests: Map<number, string>, focusSections: Set<number>): string {
  const parts = source.outline.map((section, i) => {
    const heading = section.heading ? ` heading="${attr(section.heading)}"` : "";
    if (focusSections.has(i) || !digests.has(i)) {
      return `<section index="${i}"${heading} form="full text">\n${esc(section.paragraphs.join("\n\n"))}\n</section>`;
    }
    return `<section index="${i}"${heading} form="digest">\n${esc(digests.get(i)!)}\n</section>`;
  });
  return `<article note="This source is long: sections marked 'digest' are condensed; highlighted sections are given in full.">\n${parts.join("\n\n")}\n</article>`;
}

export function chunkSectionsForDigest(outline: OutlineSection[], skip: Set<number>): { index: number; text: string }[][] {
  const chunks: { index: number; text: string }[][] = [];
  let current: { index: number; text: string }[] = [];
  let size = 0;
  outline.forEach((section, index) => {
    if (skip.has(index)) return;
    const text = truncate(sectionText(section), DIGEST_CHUNK_CHARS);
    if (size + text.length > DIGEST_CHUNK_CHARS && current.length) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push({ index, text });
    size += text.length;
  });
  if (current.length) chunks.push(current);
  return chunks;
}

export function renderDigestRequest(source: Source, chunk: { index: number; text: string }[]): string {
  const sections = chunk.map((c) => `<section index="${c.index}">\n${esc(c.text)}\n</section>`).join("\n\n");
  return `${renderSourceMeta(source)}\n\n${sections}\n\nWrite a digest for each section above, using its index.`;
}

/** Which outline sections contain the given highlights (by paragraph text match). */
export function sectionsContaining(outline: OutlineSection[], highlights: Highlight[]): Set<number> {
  const out = new Set<number>();
  for (const h of highlights) {
    const needle = h.exactText.slice(0, 80);
    const idx = outline.findIndex((s) => s.paragraphs.some((p) => p.includes(needle)) || (!!h.sectionHeading && s.heading === h.sectionHeading));
    if (idx >= 0) out.add(idx);
  }
  return out;
}

export function renderHighlights(highlights: Highlight[], alias: Map<string, string>, withContext: boolean): string {
  if (!highlights.length) return "";
  const items = highlights.map((h) => {
    const a = alias.get(h.id)!;
    const section = h.sectionHeading ? ` section="${attr(h.sectionHeading)}"` : "";
    const parts: string[] = [];
    if (withContext && h.contextBefore) parts.push(`<before>${esc(h.contextBefore)}</before>`);
    if (withContext && h.paragraph && h.paragraph !== h.exactText) parts.push(`<paragraph>${esc(h.paragraph)}</paragraph>`);
    parts.push(`<text>${esc(h.exactText)}</text>`);
    if (withContext && h.contextAfter) parts.push(`<after>${esc(h.contextAfter)}</after>`);
    if (h.userNote) parts.push(`<reader_note>${esc(h.userNote)}</reader_note>`);
    return `<highlight id="${a}"${section}>\n${parts.join("\n")}\n</highlight>`;
  });
  return `<highlights>\n${items.join("\n\n")}\n</highlights>`;
}

export function renderIdea(idea: Idea, key: string, highlightsById: Map<string, Highlight>): string {
  const evidence: string[] = idea.evidencePassages.map((p) => `<excerpt>${esc(p)}</excerpt>`);
  for (const hid of idea.evidenceHighlightIds) {
    const h = highlightsById.get(hid);
    if (!h) continue;
    const ctx = [h.contextBefore, h.paragraph || h.exactText, h.contextAfter].filter(Boolean).join("\n");
    evidence.push(`<highlight_context>${esc(truncate(ctx, 2500))}</highlight_context>`);
  }
  return [
    `<idea key="${key}" type="${idea.ideaType}" epistemic_status="${idea.epistemicStatus}" centrality="${idea.centrality}"${idea.attribution ? ` attribution="${attr(idea.attribution)}"` : ""}>`,
    `<statement>${esc(idea.statement)}</statement>`,
    `<explanation>${esc(idea.explanation)}</explanation>`,
    `<why_it_matters>${esc(idea.importanceReason)}</why_it_matters>`,
    `<evidence>\n${evidence.join("\n")}\n</evidence>`,
    `</idea>`,
  ].join("\n");
}

export function renderExistingCards(fronts: string[]): string {
  if (!fronts.length) return "";
  return `<existing_cards note="Already created for this source; do not duplicate.">\n${fronts.map((f) => `- ${esc(f)}`).join("\n")}\n</existing_cards>`;
}
