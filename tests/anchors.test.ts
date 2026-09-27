import { beforeEach, describe, expect, it } from "vitest";
import { buildTextIndex, describeRange, locateQuote, offsetsToRange } from "../src/content/anchors";
import { MARK_CLASS, unwrapHighlight, wrapRange } from "../src/content/highlighter";

const ARTICLE = `
  <article>
    <h2>Memory and thought</h2>
    <p>Spaced repetition makes memory a choice. It is <em>remarkably</em> cheap.</p>
    <p>The same sentence appears twice. Here is some context A.</p>
    <p>Other text. The same sentence appears twice. Here is some context B.</p>
    <script>var ignored = "Spaced repetition";</script>
  </article>`;

function select(el: Node, start: number, end: number, endNode: Node = el): Range {
  const r = document.createRange();
  r.setStart(el, start);
  r.setEnd(endNode, end);
  return r;
}

function reanchor(quote: { exact: string; prefix: string; suffix: string; position: { start: number; end: number } }) {
  const index = buildTextIndex(document.body);
  const loc = locateQuote(index.text, quote);
  return loc ? (offsetsToRange(index, loc.start, loc.end)?.toString() ?? "").replace(/\s+/g, " ") : null;
}

beforeEach(() => {
  document.body.innerHTML = ARTICLE;
});

describe("text anchoring", () => {
  it("describes a selection spanning inline elements, ignoring scripts", () => {
    const p = document.querySelectorAll("p")[0];
    const range = select(p.firstChild!, 0, 5, p.querySelector("em")!.firstChild!);
    const index = buildTextIndex(document.body);
    expect(index.text).not.toContain("ignored");
    const q = describeRange(index, range)!;
    expect(q.exact).toBe("Spaced repetition makes memory a choice. It is remar");
    expect(q.prefix.endsWith("Memory and thought ")).toBe(true);
  });

  it("re-anchors after the page is reloaded", () => {
    const p = document.querySelectorAll("p")[0];
    const q = describeRange(buildTextIndex(document.body), select(p.firstChild!, 0, 39))!;
    document.body.innerHTML = ARTICLE;
    expect(reanchor(q)).toBe("Spaced repetition makes memory a choice");
  });

  it("re-anchors when the DOM structure and whitespace change", () => {
    const p = document.querySelectorAll("p")[0];
    const q = describeRange(buildTextIndex(document.body), select(p.firstChild!, 0, 39))!;
    document.body.innerHTML = `<div><section><h3>Memory   and thought</h3><div><span>Spaced repetition</span>
      makes <b>memory</b> a choice. It is remarkably cheap.</div></section></div>`;
    expect(reanchor(q)).toBe("Spaced repetition makes memory a choice");
  });

  it("re-anchors when text was inserted before the highlight", () => {
    const p = document.querySelectorAll("p")[0];
    const q = describeRange(buildTextIndex(document.body), select(p.firstChild!, 0, 39))!;
    document.body.innerHTML = `<p>An editor's note was added at the top of the page.</p>` + ARTICLE;
    expect(reanchor(q)).toBe("Spaced repetition makes memory a choice");
  });

  it("uses prefix/suffix to pick the right duplicate sentence", () => {
    const second = document.querySelectorAll("p")[2].firstChild!;
    const start = "Other text. ".length;
    const q = describeRange(buildTextIndex(document.body), select(second, start, start + "The same sentence appears twice.".length))!;
    document.body.innerHTML = ARTICLE;
    const index = buildTextIndex(document.body);
    const loc = locateQuote(index.text, q)!;
    const range = offsetsToRange(index, loc.start, loc.end)!;
    expect(range.startContainer.parentElement).toBe(document.querySelectorAll("p")[2]);
  });

  it("falls back to prefix+suffix when the highlighted words were edited", () => {
    const p = document.querySelectorAll("p")[0];
    const q = describeRange(buildTextIndex(document.body), select(p.firstChild!, 0, 39))!;
    document.body.innerHTML = ARTICLE.replace("makes memory a choice", "turns memory into a choice");
    expect(reanchor(q)).toBe("Spaced repetition turns memory into a choice");
  });

  it("returns null (source location unavailable) when the passage is gone", () => {
    const p = document.querySelectorAll("p")[0];
    const q = describeRange(buildTextIndex(document.body), select(p.firstChild!, 0, 39))!;
    document.body.innerHTML = "<p>Completely different page.</p>";
    expect(reanchor(q)).toBeNull();
  });
});

describe("highlight rendering", () => {
  it("wraps and unwraps without changing page text", () => {
    const before = document.body.textContent;
    const p = document.querySelectorAll("p")[0];
    const range = select(p.firstChild!, 7, 5, p.querySelector("em")!.firstChild!);
    const marks = wrapRange(range, "hl_1");
    expect(marks.length).toBe(2);
    expect(document.querySelectorAll(`mark.${MARK_CLASS}`).length).toBe(2);
    expect(document.body.textContent).toBe(before);
    // Anchors still resolve with marks present.
    const idx = buildTextIndex(document.body);
    expect(idx.text).toContain("Spaced repetition makes memory a choice. It is remarkably cheap.");
    unwrapHighlight(document, "hl_1");
    expect(document.querySelectorAll("mark").length).toBe(0);
    expect(document.body.textContent).toBe(before);
  });
});
