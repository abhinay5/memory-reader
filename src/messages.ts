import type { CapturedHighlight, ExtractedArticle, Highlight } from "./types";

// Messages between extension contexts. Content-script requests are sent with
// chrome.tabs.sendMessage; requests to the service worker with chrome.runtime.sendMessage.

export type ContentRequest =
  | { type: "PING" }
  | { type: "EXTRACT" }
  | { type: "CAPTURE_SELECTION"; highlightId: string }
  | { type: "HAS_SELECTION" }
  | { type: "APPLY_HIGHLIGHTS"; highlights: Pick<Highlight, "id" | "exactText" | "prefix" | "suffix" | "anchorData">[] }
  | { type: "REMOVE_HIGHLIGHT"; highlightId: string }
  | { type: "SCROLL_TO_HIGHLIGHT"; highlightId: string };

export type ContentResponse =
  | { ok: true; type: "PONG" }
  | { ok: true; type: "EXTRACTED"; article: ExtractedArticle }
  | { ok: true; type: "CAPTURED"; captured: CapturedHighlight; pageTitle: string; url: string }
  | { ok: true; type: "SELECTION"; text: string }
  | { ok: true; type: "APPLIED"; results: { id: string; found: boolean }[] }
  | { ok: true; type: "DONE" }
  | { ok: false; error: string; code?: "NO_SELECTION" | "UNANCHORABLE" };

export type BackgroundRequest =
  | { type: "CONTENT_READY"; url: string }
  | { type: "ANCHOR_RESULTS"; url: string; results: { id: string; found: boolean }[] };

/** Broadcast from the service worker to any open side panel. */
export type PanelEvent =
  | { type: "PANEL_ACTIVATE"; tabId: number }
  | { type: "HIGHLIGHTS_CHANGED"; sourceId: string; tabId: number }
  | { type: "HIGHLIGHT_FAILED"; tabId: number; error: string };

export interface PendingRemember {
  highlightId: string;
  sourceId: string;
  tabId: number;
  at: number;
}
