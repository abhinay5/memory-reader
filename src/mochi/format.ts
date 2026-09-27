import type { CardCandidate, Source } from "../types";
import { slugify } from "../utils/text";

// Mochi Markdown: sides are separated by a line containing only `---`. The prompt goes on the
// front, the answer on the back. Provenance stays on the back — a third `---` section would
// become an extra review side.

/** Prevents user/AI text from accidentally creating extra sides. */
export function neutralizeSideSeparators(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (/^\s*-{3,}\s*$/.test(line) ? "—" : line))
    .join("\n")
    .trim();
}

function escapeLinkText(text: string): string {
  return text.replace(/([\\[\]])/g, "\\$1");
}

export function provenanceLine(source: Pick<Source, "title" | "author" | "url">, includeLink: boolean): string {
  const title = `“${escapeLinkText(source.title)}”`;
  const titled = includeLink && source.url ? `[${title}](${source.url.replace(/\)/g, "%29").replace(/ /g, "%20")})` : title;
  return `_Source: ${titled}${source.author ? ` — ${escapeLinkText(source.author)}` : ""}_`;
}

export function toMochiContent(
  card: Pick<CardCandidate, "front" | "back">,
  source: Pick<Source, "title" | "author" | "url">,
  options: { includeSourceLink: boolean },
): string {
  const front = neutralizeSideSeparators(card.front);
  const back = neutralizeSideSeparators(card.back);
  return `${front}\n---\n${back}\n\n${provenanceLine(source, options.includeSourceLink)}`;
}

/** A small, stable tag set: never dozens of tags. */
export function mochiTags(source: Pick<Source, "author" | "site" | "sourceType">, autoSourceTags: boolean): string[] {
  const tags = ["generated", "reading"];
  if (autoSourceTags) {
    if (source.author) {
      const firstAuthor = source.author.split(/,| and | & /i)[0];
      const slug = slugify(firstAuthor, 32);
      if (slug) tags.push(slug);
    }
    if (source.site && source.sourceType === "web_article") {
      const slug = slugify(source.site.replace(/^www\./, "").replace(/\.(com|org|net|io|co|substack\.com)$/i, ""), 32);
      if (slug && !tags.includes(slug)) tags.push(slug);
    }
  }
  return tags;
}
