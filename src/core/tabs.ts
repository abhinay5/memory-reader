import type { ContentRequest, ContentResponse } from "../messages";
import { isSupportedPageUrl } from "../utils/urls";

export class PageAccessError extends Error {
  constructor(message = "Memory Reader can't read this page yet. Click the extension icon while viewing it.") {
    super(message);
    this.name = "PageAccessError";
  }
}

/** Injects the content script (idempotent) — requires activeTab or a host permission for the tab. */
export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { type: "PING" } satisfies ContentRequest)) as ContentResponse | undefined;
    if (pong?.ok) return;
  } catch {
    // Not injected yet.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cannot access|permission|chrome:\/\/|extensions gallery|Cannot be scripted/i.test(message)) throw new PageAccessError();
    throw err;
  }
}

export async function sendToContent<T extends ContentResponse>(tabId: number, request: ContentRequest): Promise<T> {
  await ensureContentScript(tabId);
  const response = (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse | undefined;
  if (!response) throw new Error("The page did not respond. Try reloading it.");
  return response as T;
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

export function tabIsSupported(tab: chrome.tabs.Tab | undefined): boolean {
  return !!tab?.id && isSupportedPageUrl(tab.url ?? tab.pendingUrl);
}
