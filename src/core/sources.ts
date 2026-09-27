import { getSource, highlightsForSource, putHighlight, putSource } from "../storage/db";
import type { CapturedHighlight, ExtractedArticle, Highlight, Source } from "../types";
import { hashString, newId } from "../utils/hashing";
import { normalizeUrl } from "../utils/urls";
import type { ContentResponse } from "../messages";
import { sendToContent } from "./tabs";

export function sourceIdForUrl(url: string): string {
  return `src_${hashString(normalizeUrl(url))}`;
}

function emptyWebSource(url: string, title: string): Source {
  const now = Date.now();
  return {
    id: sourceIdForUrl(url),
    url,
    canonicalUrl: null,
    title: title || url,
    author: null,
    site: safeHost(url),
    sourceType: "web_article",
    extractedText: "",
    outline: [],
    wordCount: 0,
    contentHash: "",
    thesis: null,
    summary: null,
    createdAt: now,
    updatedAt: now,
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function ensureWebSource(url: string, title: string): Promise<Source> {
  const existing = await getSource(sourceIdForUrl(url));
  if (existing) return existing;
  const source = emptyWebSource(url, title);
  await putSource(source);
  return source;
}

/** Merges a fresh extraction into the stored source (keeping analysis results when text is unchanged). */
export async function upsertFromExtraction(article: ExtractedArticle): Promise<Source> {
  const id = sourceIdForUrl(article.url);
  const existing = await getSource(id);
  const base = existing ?? emptyWebSource(article.url, article.title);
  const textChanged = !!existing?.contentHash && existing.contentHash !== article.contentHash;
  const source: Source = {
    ...base,
    url: article.url,
    canonicalUrl: article.canonicalUrl,
    title: article.title,
    author: article.author,
    site: article.site,
    extractedText: article.text,
    outline: article.sections,
    wordCount: article.wordCount,
    contentHash: article.contentHash,
    thesis: textChanged ? null : base.thesis,
    summary: textChanged ? null : base.summary,
    updatedAt: Date.now(),
  };
  await putSource(source);
  return source;
}

export async function createPastedSource(input: {
  title: string;
  author: string | null;
  url: string | null;
  kind: "pasted_highlights" | "pasted_text";
  text: string;
  passages: { text: string; note: string | null }[];
}): Promise<{ source: Source; highlights: Highlight[] }> {
  const now = Date.now();
  const source: Source = {
    id: newId("src"),
    url: input.url,
    canonicalUrl: null,
    title: input.title || "Pasted highlights",
    author: input.author,
    site: input.url ? safeHost(input.url) : null,
    sourceType: input.kind,
    extractedText: input.text,
    outline: [{ heading: null, level: 0, paragraphs: input.passages.map((p) => p.text) }],
    wordCount: input.text.split(/\s+/).filter(Boolean).length,
    contentHash: hashString(input.text),
    thesis: null,
    summary: null,
    createdAt: now,
    updatedAt: now,
  };
  await putSource(source);
  const highlights: Highlight[] = input.passages.map((p, i) => ({
    id: newId("hl"),
    sourceId: source.id,
    exactText: p.text,
    prefix: "",
    suffix: "",
    sectionHeading: null,
    paragraph: p.text,
    contextBefore: input.passages[i - 1]?.text ?? "",
    contextAfter: input.passages[i + 1]?.text ?? "",
    anchorData: null,
    anchorStatus: "unavailable",
    userNote: p.note,
    createdAt: now + i,
  }));
  for (const h of highlights) await putHighlight(h);
  return { source, highlights };
}

/** Captures the current selection in a tab as a persistent highlight. */
export async function highlightSelectionInTab(tabId: number): Promise<Highlight> {
  const highlightId = newId("hl");
  const response = await sendToContent<ContentResponse>(tabId, { type: "CAPTURE_SELECTION", highlightId });
  if (!response.ok) throw new Error(response.error);
  if (response.type !== "CAPTURED") throw new Error("Unexpected response from page.");
  const source = await ensureWebSource(response.url, response.pageTitle);
  const c: CapturedHighlight = response.captured;
  const highlight: Highlight = {
    id: highlightId,
    sourceId: source.id,
    exactText: c.exactText,
    prefix: c.prefix,
    suffix: c.suffix,
    sectionHeading: c.sectionHeading,
    paragraph: c.paragraph,
    contextBefore: c.contextBefore,
    contextAfter: c.contextAfter,
    anchorData: c.anchor,
    anchorStatus: "anchored",
    userNote: null,
    createdAt: Date.now(),
  };
  await putHighlight(highlight);
  await putSource({ ...source, updatedAt: Date.now() });
  return highlight;
}

export async function highlightsForUrl(url: string): Promise<Highlight[]> {
  return highlightsForSource(sourceIdForUrl(url));
}
