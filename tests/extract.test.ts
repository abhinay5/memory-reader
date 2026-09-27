import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { contextForNode } from "../src/content/context";
import { extractArticle, sectionsFromContainer } from "../src/content/extract";

const html = readFileSync(resolve(process.cwd(), "tests/fixtures/article.html"), "utf8");

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^<!doctype html>\s*<html>|<\/html>\s*$/gi, "");
});

describe("article extraction", () => {
  it("extracts metadata, sections and statistics without page chrome", async () => {
    const article = await extractArticle(document);
    expect(article.title).toBe("Augmenting Long-term Memory");
    expect(article.author).toBe("Michael Nielsen");
    expect(article.site).toBe("Example Essays");
    expect(article.canonicalUrl).toBe("https://example.com/augmenting-memory");
    expect(article.method).toBe("readability");
    expect(article.text).toContain("Internalized knowledge greatly increases");
    expect(article.text).not.toContain("cookies");
    expect(article.text).not.toContain("productivity hacks");
    expect(article.text).not.toContain("All rights reserved");
    const headings = article.sections.map((s) => s.heading).filter(Boolean);
    expect(headings).toEqual(["The role of memory in creative work", "Practical principles"]);
    const principles = article.sections.find((s) => s.heading === "Practical principles")!;
    expect(principles.paragraphs.some((p) => p.startsWith("• Do not try to remember"))).toBe(true);
    expect(article.wordCount).toBeGreaterThan(150);
    expect(article.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for the same content", async () => {
    const a = await extractArticle(document);
    const b = await extractArticle(document);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("keeps heading-to-paragraph relationships", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>Intro</p><h2>A</h2><p>a1</p><p>a2</p><h3>B</h3><p>b1</p>";
    expect(sectionsFromContainer(div)).toEqual([
      { heading: null, level: 0, paragraphs: ["Intro"] },
      { heading: "A", level: 2, paragraphs: ["a1", "a2"] },
      { heading: "B", level: 3, paragraphs: ["b1"] },
    ]);
  });
});

describe("selection context", () => {
  it("captures paragraph, neighbours and section heading", () => {
    const target = Array.from(document.querySelectorAll("p")).find((p) => p.textContent!.startsWith("Isolated questions"))!;
    const ctx = contextForNode(target.firstChild!);
    expect(ctx.sectionHeading).toBe("The role of memory in creative work");
    expect(ctx.paragraph).toMatch(/^Isolated questions tend to become orphans/);
    expect(ctx.contextBefore).toMatch(/^Internalized knowledge/);
    expect(ctx.contextAfter).toBe("");
  });
});
