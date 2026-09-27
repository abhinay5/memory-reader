import type { TextAnchor } from "../types";
import { looseChars } from "../utils/text";

// Text-quote anchoring (exact + prefix + suffix, with a position hint), in the spirit of the
// W3C Web Annotation selectors. Everything works on a whitespace-normalised view of the
// page text so that re-rendered markup or reflowed whitespace does not break anchors.

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "TEMPLATE", "IFRAME", "OBJECT", "SVG", "CANVAS"]);
const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "TH", "TR",
  "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "NAV", "FIGURE", "FIGCAPTION", "DD", "DT", "DL",
  "BR", "HR", "MAIN", "ADDRESS", "DETAILS", "SUMMARY",
]);

export const CONTEXT_CHARS = 48;

export interface TextIndex {
  /** Normalised text: whitespace runs collapsed to one space, block boundaries become spaces. */
  text: string;
  nodes: Text[];
  /** For each char in `text`: index into `nodes`, or -1 for a synthetic boundary space. */
  nodeIndex: Int32Array;
  /** For each char in `text`: offset inside its node (meaningless when nodeIndex is -1). */
  offset: Int32Array;
}

function isSkipped(node: Node, root: Node): boolean {
  for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    if (el.getAttribute("aria-hidden") === "true" && el.tagName !== "MARK") return true;
  }
  return false;
}

function blockAncestor(node: Node): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (BLOCK_TAGS.has(el.tagName.toUpperCase())) return el;
  }
  return null;
}

export function buildTextIndex(root: Node): TextIndex {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const chars: string[] = [];
  const nodeIdx: number[] = [];
  const offs: number[] = [];
  let prevSpace = true;
  let prevBlock: Element | null = null;

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const textNode = n as Text;
    if (!textNode.data || isSkipped(textNode, root)) continue;
    const block = blockAncestor(textNode);
    if (block !== prevBlock && !prevSpace && chars.length > 0) {
      chars.push(" ");
      nodeIdx.push(-1);
      offs.push(0);
      prevSpace = true;
    }
    prevBlock = block;
    const ni = nodes.push(textNode) - 1;
    const data = textNode.data;
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (/\s/.test(c)) {
        if (prevSpace) continue;
        chars.push(" ");
        prevSpace = true;
      } else {
        chars.push(c);
        prevSpace = false;
      }
      nodeIdx.push(ni);
      offs.push(i);
    }
  }
  return { text: chars.join(""), nodes, nodeIndex: Int32Array.from(nodeIdx), offset: Int32Array.from(offs) };
}

/** Converts a DOM range into normalised [start, end) offsets, trimmed of surrounding spaces. */
export function rangeToOffsets(index: TextIndex, range: Range): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  const nodeInRange = new Map<number, boolean>();
  for (let i = 0; i < index.text.length; i++) {
    const ni = index.nodeIndex[i];
    if (ni < 0) continue;
    let inRange = nodeInRange.get(ni);
    if (inRange === undefined) {
      inRange = range.intersectsNode(index.nodes[ni]);
      nodeInRange.set(ni, inRange);
    }
    if (!inRange) {
      if (start >= 0) break;
      continue;
    }
    const node = index.nodes[ni];
    const off = index.offset[i];
    if (node === range.startContainer && off < range.startOffset) continue;
    if (node === range.endContainer && off >= range.endOffset) continue;
    if (start < 0) start = i;
    end = i + 1;
  }
  if (start < 0) return null;
  while (start < end && index.text[start] === " ") start++;
  while (end > start && index.text[end - 1] === " ") end--;
  return end > start ? { start, end } : null;
}

export interface QuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  position: TextAnchor;
}

export function describeRange(index: TextIndex, range: Range): QuoteAnchor | null {
  const offsets = rangeToOffsets(index, range);
  if (!offsets) return null;
  return {
    exact: index.text.slice(offsets.start, offsets.end),
    prefix: index.text.slice(Math.max(0, offsets.start - CONTEXT_CHARS), offsets.start),
    suffix: index.text.slice(offsets.end, offsets.end + CONTEXT_CHARS),
    position: offsets,
  };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function allOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * Finds the best location for a stored quote in the current page text.
 * 1. every occurrence of the exact quote, scored by how well prefix/suffix match (so duplicate
 *    sentences resolve to the right one), tie-broken by distance from the original position;
 * 2. if the quote itself was edited, the span between a matching prefix and suffix.
 */
export function locateQuote(
  text: string,
  quote: { exact: string; prefix: string; suffix: string; position?: TextAnchor | null },
): { start: number; end: number } | null {
  const norm = (s: string) => looseChars(s.replace(/\s+/g, " "));
  const hay = norm(text);
  const exact = norm(quote.exact).trim();
  const prefix = norm(quote.prefix);
  const suffix = norm(quote.suffix);
  if (!exact) return null;

  const candidates = allOccurrences(hay, exact);
  if (candidates.length > 0) {
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const start of candidates) {
      const before = hay.slice(Math.max(0, start - prefix.length), start);
      const after = hay.slice(start + exact.length, start + exact.length + suffix.length);
      let score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
      if (quote.position) score -= Math.abs(start - quote.position.start) / 1e6;
      if (score > bestScore) {
        bestScore = score;
        best = start;
      }
    }
    return { start: best, end: best + exact.length };
  }

  // Fallback: the highlighted text changed slightly, but its surroundings did not.
  const pre = prefix.trim();
  const suf = suffix.trim();
  if (pre.length >= 16 && suf.length >= 16) {
    for (const p of allOccurrences(hay, pre)) {
      const from = p + pre.length;
      const s = hay.indexOf(suf, from);
      if (s === -1) continue;
      const gap = s - from;
      if (gap > 0 && gap <= exact.length * 2 + 40 && gap >= exact.length / 2) {
        let start = from;
        let end = s;
        while (start < end && hay[start] === " ") start++;
        while (end > start && hay[end - 1] === " ") end--;
        if (end > start) return { start, end };
      }
    }
  }
  return null;
}

/** Turns normalised offsets back into a live DOM Range. */
export function offsetsToRange(index: TextIndex, start: number, end: number): Range | null {
  let s = start;
  let e = end - 1;
  while (s <= e && index.nodeIndex[s] < 0) s++;
  while (e >= s && index.nodeIndex[e] < 0) e--;
  if (s > e) return null;
  const doc = index.nodes[0].ownerDocument;
  const range = doc.createRange();
  range.setStart(index.nodes[index.nodeIndex[s]], index.offset[s]);
  range.setEnd(index.nodes[index.nodeIndex[e]], index.offset[e] + 1);
  return range;
}
