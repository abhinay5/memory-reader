import { collapseWhitespace, truncate } from "../utils/text";

// Reconstructs the local context of a selection so the model never sees a sentence alone:
// containing paragraph, neighbouring paragraphs and the governing section heading.

const BLOCK_SELECTOR = "p, li, blockquote, pre, dd, dt, figcaption, td, th, h1, h2, h3, h4, h5, h6";
const HEADING = /^H[1-6]$/;
const MAX_PARAGRAPH = 2000;
const MAX_NEIGHBOUR = 1200;

export interface SelectionContext {
  sectionHeading: string | null;
  paragraph: string;
  contextBefore: string;
  contextAfter: string;
}

function leafBlocks(root: ParentNode): Element[] {
  // Keep innermost blocks only (an <li> wrapping a <p> contributes the <p>).
  return Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter((el) => !el.querySelector(BLOCK_SELECTOR));
}

function textOf(el: Element): string {
  return collapseWhitespace(el.textContent ?? "");
}

export function contextForNode(node: Node, doc: Document = document): SelectionContext {
  const blocks = leafBlocks(doc.body ?? doc);
  let idx = blocks.findIndex((b) => b.contains(node));
  if (idx === -1) {
    // Selection inside a non-standard container (e.g. <div> text); fall back to the parent element.
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const paragraph = el ? textOf(el.closest("div, section, article") ?? el) : "";
    return { sectionHeading: null, paragraph: truncate(paragraph, MAX_PARAGRAPH), contextBefore: "", contextAfter: "" };
  }
  const collect = (from: number, step: 1 | -1): string => {
    const parts: string[] = [];
    let length = 0;
    for (let i = from; i >= 0 && i < blocks.length && length < MAX_NEIGHBOUR; i += step) {
      if (HEADING.test(blocks[i].tagName)) break;
      const t = textOf(blocks[i]);
      if (!t) continue;
      parts.push(t);
      length += t.length;
      if (parts.length >= 2) break;
    }
    if (step === -1) parts.reverse();
    return truncate(parts.join("\n\n"), MAX_NEIGHBOUR);
  };
  let sectionHeading: string | null = null;
  for (let i = idx; i >= 0; i--) {
    if (HEADING.test(blocks[i].tagName) && !blocks[i].contains(node)) {
      sectionHeading = textOf(blocks[i]) || null;
      break;
    }
  }
  return {
    sectionHeading,
    paragraph: truncate(textOf(blocks[idx]), MAX_PARAGRAPH),
    contextBefore: collect(idx - 1, -1),
    contextAfter: collect(idx + 1, 1),
  };
}
