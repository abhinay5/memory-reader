import { highlightSelectionInTab, highlightsForUrl, sourceIdForUrl } from "../core/sources";
import { ensureContentScript } from "../core/tabs";
import type { BackgroundRequest, PanelEvent, PendingRemember } from "../messages";
import { getHighlight, highlightsForSource, putHighlight } from "../storage/db";
import { loadSettings } from "../storage/settings";
import { isSupportedPageUrl } from "../utils/urls";

// The service worker is woken by Chrome on demand; no background process needs to keep running.

const MENU_HIGHLIGHT = "memory-reader-highlight";
const MENU_REMEMBER = "memory-reader-remember";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_HIGHLIGHT, title: "Highlight selection", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU_REMEMBER, title: "Highlight + remember this", contexts: ["selection"] });
  });
});

function broadcast(event: PanelEvent): void {
  chrome.runtime.sendMessage(event).catch(() => {
    // No side panel open — nothing to notify.
  });
}

function openPanel(tab: chrome.tabs.Tab): void {
  // Must be called synchronously inside the user gesture, before any await.
  if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
}

chrome.action.onClicked.addListener((tab) => {
  openPanel(tab);
  if (tab.id !== undefined) {
    // Give a freshly opened panel a moment to register its listener.
    setTimeout(() => broadcast({ type: "PANEL_ACTIVATE", tabId: tab.id! }), 150);
  }
});

async function highlight(tab: chrome.tabs.Tab, remember: boolean): Promise<void> {
  if (tab.id === undefined) return;
  try {
    const h = await highlightSelectionInTab(tab.id);
    broadcast({ type: "HIGHLIGHTS_CHANGED", sourceId: h.sourceId, tabId: tab.id });
    if (remember) {
      const pending: PendingRemember = { highlightId: h.id, sourceId: h.sourceId, tabId: tab.id, at: Date.now() };
      await chrome.storage.session.set({ pendingRemember: pending });
    }
  } catch (err) {
    broadcast({ type: "HIGHLIGHT_FAILED", tabId: tab.id, error: err instanceof Error ? err.message : String(err) });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === MENU_REMEMBER) {
    openPanel(tab);
    void highlight(tab, true);
  } else if (info.menuItemId === MENU_HIGHLIGHT) {
    void highlight(tab, false);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab) return;
  if (command === "remember-selection") {
    openPanel(tab);
    void highlight(tab, true);
  } else if (command === "highlight-selection") {
    void highlight(tab, false);
  }
});

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
  if (msg.type === "CONTENT_READY") {
    highlightsForUrl(msg.url).then(
      (list) => sendResponse(list.map(({ id, exactText, prefix, suffix, anchorData }) => ({ id, exactText, prefix, suffix, anchorData }))),
      () => sendResponse([]),
    );
    return true;
  }
  if (msg.type === "ANCHOR_RESULTS") {
    void (async () => {
      for (const r of msg.results) {
        const h = await getHighlight(r.id);
        const status = r.found ? "anchored" : "unavailable";
        if (h && h.anchorStatus !== status) await putHighlight({ ...h, anchorStatus: status });
      }
      if (sender.tab?.id !== undefined) {
        broadcast({ type: "HIGHLIGHTS_CHANGED", sourceId: sourceIdForUrl(msg.url), tabId: sender.tab.id });
      }
    })();
    return false;
  }
  return false;
});

// Optional: re-render highlights automatically on reload. Only active when the user granted the
// optional host permission in Settings; otherwise highlights reappear when the panel is opened.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isSupportedPageUrl(tab.url)) return;
  void (async () => {
    const settings = await loadSettings();
    if (!settings.autoRestoreHighlights) return;
    const origin = new URL(tab.url!).origin + "/*";
    if (!(await chrome.permissions.contains({ origins: [origin] }))) return;
    const list = await highlightsForSource(sourceIdForUrl(tab.url!));
    if (list.length === 0) return;
    await ensureContentScript(tabId).catch(() => {});
  })();
});
