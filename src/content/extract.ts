import { isProbablyReaderable, Readability } from "@mozilla/readability";
import type { ExtractedArticle, OutlineSection } from "../types";
import { sha256 } from "../utils/hashing";
import { collapseWhitespace, countWords } from "../utils/text";
import { MARK_CLASS } from "./highlighter";

const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, dd, dt, td";

function meta(doc: Document, selectors: string[]): string | null {
  for (const sel of selectors) {
    const value = doc.querySelector<HTMLMetaElement>(sel)?.content?.trim();
    if (value) return value;
  }
  return null;
}

/** Turns article HTML into heading-scoped sections of plain-text paragraphs. */
export function sectionsFromContainer(container: ParentNode): OutlineSection[] {
  const sections: OutlineSection[] = [{ heading: null, level: 0, paragraphs: [] }];
  const blocks = Array.from(container.querySelectorAll(BLOCKS)).filter(
    (el) => !el.querySelector(BLOCKS) || /^H[1-6]$/.test(el.tagName),
  );
  for (const el of blocks) {
    const text = collapseWhitespace(el.textContent ?? "");
    if (!text) continue;
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) {
      sections.push({ heading: text, level: Number(m[1]), paragraphs: [] });
    } else {
      sections[sections.length - 1].paragraphs.push(el.tagName === "LI" ? `• ${text}` : text);
    }
  }
  return sections.filter((s) => s.paragraphs.length > 0 || s.heading);
}

export function sectionsToText(sections: OutlineSection[]): string {
  return sections
    .map((s) => [s.heading ? `${"#".repeat(Math.max(1, s.level))} ${s.heading}` : "", ...s.paragraphs].filter(Boolean).join("\n\n"))
    .filter(Boolean)
    .join("\n\n");
}

/** Removes " | Site Name"-style suffixes, preferring the page's own <h1> when it matches. */
export function cleanTitle(raw: string, site: string | null, doc: Document): string {
  const title = collapseWhitespace(raw);
  const h1s = Array.from(doc.querySelectorAll("h1")).map((h) => collapseWhitespace(h.textContent ?? ""));
  const h1 = h1s.find((h) => h.length > 3 && title.startsWith(h) && title.length > h.length);
  if (h1 && /^\s*[|–—\-:·•»]/.test(title.slice(h1.length))) return h1;
  if (site) {
    const m = new RegExp(`\\s+[|–—\\-·•»]\\s+${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i").exec(title);
    if (m) return title.slice(0, m.index);
  }
  return title;
}

export async function extractArticle(doc: Document = document): Promise<ExtractedArticle> {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
  const metaAuthor = meta(doc, ['meta[name="author"]', 'meta[property="article:author"]', 'meta[name="parsely-author"]']);
  const metaSite = meta(doc, ['meta[property="og:site_name"]', 'meta[name="application-name"]']);
  const readerable = isProbablyReaderable(doc);

  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll(`mark.${MARK_CLASS}`).forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
  let parsed: ReturnType<Readability<string>["parse"]> = null;
  try {
    parsed = new Readability(clone, { charThreshold: 250, keepClasses: false }).parse();
  } catch {
    parsed = null;
  }

  let sections: OutlineSection[];
  let method: ExtractedArticle["method"] = "readability";
  if (parsed?.content) {
    const container = new DOMParser().parseFromString(parsed.content, "text/html").body;
    sections = sectionsFromContainer(container);
  } else {
    method = "fallback";
    const main = doc.querySelector("article, main, [role=main]") ?? doc.body;
    sections = sectionsFromContainer(main);
  }
  const site = (parsed?.siteName && collapseWhitespace(parsed.siteName)) || metaSite || doc.location?.hostname || null;
  const title = cleanTitle(parsed?.title || doc.title || "Untitled page", site, doc);
  // Readability sometimes repeats the title as the first heading.
  if (sections[0]?.heading && collapseWhitespace(sections[0].heading) === title && sections[0].paragraphs.length === 0) {
    sections.shift();
  }
  const text = sectionsToText(sections);
  const byline = parsed?.byline ? collapseWhitespace(parsed.byline).replace(/^by\s+/i, "") : null;

  return {
    url: doc.location?.href ?? "",
    canonicalUrl: canonical,
    title,
    author: byline || metaAuthor,
    site,
    sections,
    text,
    wordCount: countWords(text),
    contentHash: await sha256(text),
    readerable,
    method,
  };
}
