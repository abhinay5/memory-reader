import type { BackgroundRequest, ContentRequest, ContentResponse } from "../messages";
import type { Highlight } from "../types";
import { buildTextIndex, describeRange, locateQuote, offsetsToRange } from "./anchors";
import { contextForNode } from "./context";
import { extractArticle } from "./extract";
import { ensureHighlightStyles, isRendered, scrollToHighlight, unwrapHighlight, wrapRange } from "./highlighter";

// Injected on demand (activeTab + scripting). Guarded so repeated injection is harmless.

declare global {
  interface Window {
    __memoryReaderLoaded?: boolean;
  }
}

type AnchorInput = Pick<Highlight, "id" | "exactText" | "prefix" | "suffix" | "anchorData">;

function applyHighlight(h: AnchorInput): boolean {
  if (isRendered(document, h.id)) return true;
  const index = buildTextIndex(document.body);
  const loc = locateQuote(index.text, { exact: h.exactText, prefix: h.prefix, suffix: h.suffix, position: h.anchorData });
  if (!loc) return false;
  const range = offsetsToRange(index, loc.start, loc.end);
  if (!range) return false;
  ensureHighlightStyles(document);
  return wrapRange(range, h.id).length > 0;
}

function captureSelection(highlightId: string): ContentResponse {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
    return { ok: false, code: "NO_SELECTION", error: "Select some text on the page first." };
  }
  const range = selection.getRangeAt(0);
  const index = buildTextIndex(document.body);
  const quote = describeRange(index, range);
  if (!quote) return { ok: false, code: "UNANCHORABLE", error: "This selection can't be highlighted (it may be inside a form or frame)." };
  const context = contextForNode(range.startContainer);
  ensureHighlightStyles(document);
  const exactRange = offsetsToRange(index, quote.position.start, quote.position.end) ?? range;
  wrapRange(exactRange, highlightId);
  selection.removeAllRanges();
  return {
    ok: true,
    type: "CAPTURED",
    pageTitle: document.title,
    url: location.href,
    captured: {
      exactText: quote.exact,
      prefix: quote.prefix,
      suffix: quote.suffix,
      anchor: quote.position,
      ...context,
    },
  };
}

async function handle(msg: ContentRequest): Promise<ContentResponse> {
  switch (msg.type) {
    case "PING":
      return { ok: true, type: "PONG" };
    case "EXTRACT":
      return { ok: true, type: "EXTRACTED", article: await extractArticle(document) };
    case "HAS_SELECTION":
      return { ok: true, type: "SELECTION", text: window.getSelection()?.toString() ?? "" };
    case "CAPTURE_SELECTION":
      return captureSelection(msg.highlightId);
    case "APPLY_HIGHLIGHTS":
      return { ok: true, type: "APPLIED", results: msg.highlights.map((h) => ({ id: h.id, found: applyHighlight(h) })) };
    case "REMOVE_HIGHLIGHT":
      unwrapHighlight(document, msg.highlightId);
      return { ok: true, type: "DONE" };
    case "SCROLL_TO_HIGHLIGHT":
      return scrollToHighlight(document, msg.highlightId) ? { ok: true, type: "DONE" } : { ok: false, error: "Highlight is not on this page." };
  }
}

if (!window.__memoryReaderLoaded) {
  window.__memoryReaderLoaded = true;

  chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
    handle(msg).then(sendResponse, (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  });

  // Restore saved highlights for this page as soon as the script is present.
  const ready: BackgroundRequest = { type: "CONTENT_READY", url: location.href };
  chrome.runtime.sendMessage(ready).then(
    (highlights: AnchorInput[] | undefined) => {
      if (!highlights?.length) return;
      const results = highlights.map((h) => ({ id: h.id, found: applyHighlight(h) }));
      chrome.runtime.sendMessage({ type: "ANCHOR_RESULTS", url: location.href, results }).catch(() => {});
    },
    () => {},
  );
}
