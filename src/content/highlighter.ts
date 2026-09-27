// Renders highlights as <mark> elements without disturbing page text content, so that the
// text index (and therefore every other anchor) is unaffected by wrapping.

export const MARK_CLASS = "memory-reader-hl";
const STYLE_ID = "memory-reader-style";

function attrValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function ensureHighlightStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    mark.${MARK_CLASS} { background: rgba(255, 214, 102, 0.55); color: inherit; padding: 0; border-radius: 2px;
      box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    mark.${MARK_CLASS}.memory-reader-focus { background: rgba(255, 170, 51, 0.8); transition: background .6s; }
    @media (prefers-color-scheme: dark) { mark.${MARK_CLASS} { background: rgba(255, 196, 0, 0.35); } }
  `;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** Wraps every text segment inside `range` with a mark carrying the highlight id. */
export function wrapRange(range: Range, id: string): HTMLElement[] {
  const doc = range.startContainer.ownerDocument!;
  const root = range.commonAncestorContainer;
  const segments: { node: Text; start: number; end: number }[] = [];

  const consider = (node: Text) => {
    if (!range.intersectsNode(node)) return;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (end > start && node.data.slice(start, end).trim().length > 0) segments.push({ node, start, end });
  };

  if (root.nodeType === Node.TEXT_NODE) {
    consider(root as Text);
  } else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) consider(n as Text);
  }

  const marks: HTMLElement[] = [];
  for (const { node, start, end } of segments) {
    let target = node;
    if (start > 0) target = target.splitText(start);
    if (end - start < target.data.length) target.splitText(end - start);
    const mark = doc.createElement("mark");
    mark.className = MARK_CLASS;
    mark.dataset.memoryReaderId = id;
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}

export function unwrapHighlight(doc: Document, id: string): void {
  const marks = doc.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}[data-memory-reader-id="${attrValue(id)}"]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

export function isRendered(doc: Document, id: string): boolean {
  return doc.querySelector(`mark.${MARK_CLASS}[data-memory-reader-id="${attrValue(id)}"]`) !== null;
}

export function scrollToHighlight(doc: Document, id: string): boolean {
  const mark = doc.querySelector<HTMLElement>(`mark.${MARK_CLASS}[data-memory-reader-id="${attrValue(id)}"]`);
  if (!mark) return false;
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
  const all = doc.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}[data-memory-reader-id="${attrValue(id)}"]`);
  all.forEach((m) => m.classList.add("memory-reader-focus"));
  setTimeout(() => all.forEach((m) => m.classList.remove("memory-reader-focus")), 1400);
  return true;
}
