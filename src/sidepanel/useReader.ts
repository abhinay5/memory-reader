import { useCallback, useEffect, useRef, useState } from "react";
import { AIError, AnthropicLLM } from "../ai/llm";
import { analyzeSource, generateCards, regenerateCard, type PipelineStage } from "../ai/pipeline";
import type { RegenerateDirection } from "../ai/prompts";
import { ClaudeProvider } from "../ai/provider";
import { createPastedSource, highlightSelectionInTab, sourceIdForUrl, upsertFromExtraction } from "../core/sources";
import { getActiveTab, PageAccessError, sendToContent, tabIsSupported } from "../core/tabs";
import type { ContentResponse, PanelEvent, PendingRemember } from "../messages";
import {
  cardsForSource,
  deleteHighlight,
  getSource,
  highlightsForSource,
  ideasForRun,
  putCard,
  putCards,
  putHighlight,
  putIdeas,
  putSource,
  runsForSource,
} from "../storage/db";
import { loadSettings, onSettingsChanged } from "../storage/settings";
import type { CardCandidate, GenerationRun, GenerationScope, Highlight, Idea, Settings, Source, StudyMode } from "../types";

export type PageState =
  | { kind: "loading" }
  | { kind: "ready"; tabId: number }
  | { kind: "unsupported" }
  | { kind: "no_access"; tabId: number }
  | { kind: "detached" } // viewing a pasted/library source not tied to the tab
  | { kind: "error"; message: string };

export type View = "home" | "ideas" | "cards" | "paste" | "library";

export interface Busy {
  label: string;
  stages: PipelineStage[];
  current: PipelineStage | null;
}

export interface Notice {
  tone: "info" | "error" | "success";
  text: string;
}

function describeError(err: unknown): string {
  if (err instanceof AIError || err instanceof PageAccessError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function useReader() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [source, setSource] = useState<Source | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [cards, setCards] = useState<CardCandidate[]>([]);
  const [runs, setRuns] = useState<GenerationRun[]>([]);
  const [activeRun, setActiveRun] = useState<GenerationRun | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [view, setView] = useState<View>("home");
  const [busy, setBusy] = useState<Busy | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mode, setMode] = useState<StudyMode>("understand");
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const abortRef = useRef<AbortController | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy !== null;
  const pageKindRef = useRef<PageState["kind"]>("loading");
  pageKindRef.current = page.kind;

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setMode(s.studyMode);
    });
    const off = onSettingsChanged(setSettings);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      off();
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const loadSourceData = useCallback(async (sourceId: string, preferRunId?: string) => {
    sourceIdRef.current = sourceId;
    const [src, hl, cs, rs] = await Promise.all([getSource(sourceId), highlightsForSource(sourceId), cardsForSource(sourceId), runsForSource(sourceId)]);
    if (sourceIdRef.current !== sourceId) return;
    setSource(src ?? null);
    setHighlights(hl);
    setCards(cs);
    setRuns(rs);
    const run = (preferRunId && rs.find((r) => r.id === preferRunId)) || rs[rs.length - 1] || null;
    setActiveRun(run);
    setIdeas(run ? await ideasForRun(run.id) : []);
  }, []);

  const refreshHighlights = useCallback(async () => {
    if (sourceIdRef.current) setHighlights(await highlightsForSource(sourceIdRef.current));
  }, []);

  const refreshCards = useCallback(async () => {
    if (sourceIdRef.current) setCards(await cardsForSource(sourceIdRef.current));
  }, []);

  /** Reads the active tab: extracts the article and restores its highlights. */
  const attachToActiveTab = useCallback(async () => {
    if (busyRef.current) return;
    // `?tabId=` pins the panel to a tab when sidepanel.html is opened directly (used by the e2e smoke test).
    const pinned = Number(new URLSearchParams(location.search).get("tabId"));
    const tab = pinned ? await chrome.tabs.get(pinned).catch(() => undefined) : await getActiveTab();
    if (!tab?.id || !tabIsSupported(tab)) {
      setPage({ kind: "unsupported" });
      setSource(null);
      sourceIdRef.current = null;
      setView((v) => (v === "paste" || v === "library" ? v : "home"));
      return;
    }
    const tabId = tab.id;
    setPage({ kind: "loading" });
    try {
      const response = await sendToContent<ContentResponse>(tabId, { type: "EXTRACT" });
      if (!response.ok) throw new Error(response.error);
      if (response.type !== "EXTRACTED") throw new Error("Unexpected response from page.");
      const src = await upsertFromExtraction(response.article);
      if (sourceIdRef.current !== src.id) setView("home");
      await loadSourceData(src.id);
      setPage({ kind: "ready", tabId });
    } catch (err) {
      if (err instanceof PageAccessError) {
        setPage({ kind: "no_access", tabId });
        // Still show whatever we stored for this URL (works offline too).
        if (tab.url) await loadSourceData(sourceIdForUrl(tab.url));
      } else {
        setPage({ kind: "error", message: describeError(err) });
      }
    }
  }, [loadSourceData]);

  const provider = useCallback((): ClaudeProvider => {
    if (!settings?.anthropicApiKey) throw new AIError("auth", "Add your Anthropic API key in Settings first.");
    return new ClaudeProvider(new AnthropicLLM(settings.anthropicApiKey, settings.model));
  }, [settings]);

  const runTask = useCallback(async (label: string, stages: PipelineStage[], fn: (signal: AbortSignal, onStage: (s: PipelineStage) => void) => Promise<void>) => {
    if (!navigator.onLine) {
      setNotice({ tone: "error", text: "Internet connection required for AI generation. Your highlights and cards are saved." });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice(null);
    setBusy({ label, stages, current: stages[0] ?? null });
    try {
      await fn(controller.signal, (s) => setBusy((b) => (b ? { ...b, current: s } : b)));
    } catch (err) {
      if (!controller.signal.aborted) setNotice({ tone: "error", text: describeError(err) });
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  /** Workflow A (article): analysis only — the reader inspects the idea map before cards exist. */
  const analyzeArticle = useCallback(async () => {
    if (!source) return;
    await runTask("Analyzing article", ["reading", "finding_ideas"], async (signal, onStage) => {
      const outcome = await analyzeSource({ provider: provider(), source, highlights, scope: "article", mode, onStage, signal });
      await loadSourceData(source.id, outcome.run.id);
      setView("ideas");
    });
  }, [source, highlights, mode, provider, runTask, loadSourceData]);

  /** Workflows B and C: understand the highlights, then design cards in one go. */
  const generateFromHighlights = useCallback(
    async (scope: GenerationScope, selected: Highlight[], src: Source | null = source) => {
      if (!src || selected.length === 0) return;
      const label = scope === "selection" ? "Remembering selection" : `Generating from ${selected.length} highlight${selected.length === 1 ? "" : "s"}`;
      await runTask(label, ["reading", "finding_ideas", "designing_prompts", "checking_quality"], async (signal, onStage) => {
        const p = provider();
        const outcome = await analyzeSource({ provider: p, source: src, highlights: selected, scope, mode, onStage, signal });
        const approved = outcome.ideas.filter((i) => i.status === "approved" || (scope === "selection" && i.grounded));
        const gen = await generateCards({ provider: p, source: (await getSource(src.id)) ?? src, run: outcome.run, ideas: approved, highlights: selected, mode, onStage, signal });
        await loadSourceData(src.id, gen.run.id);
        setView("cards");
        if (gen.cards.length === 0) {
          setNotice({ tone: "info", text: outcome.ideas.length === 0 ? "Nothing here seemed worth a long-term card. See how your highlights were interpreted below." : "No cards were worth keeping from these ideas." });
        }
      });
    },
    [source, mode, provider, runTask, loadSourceData],
  );

  /** Second stage of workflow A: cards for the ideas the reader kept on the article map. */
  const generateForIdeas = useCallback(async () => {
    if (!source || !activeRun) return;
    const chosen = ideas.filter((i) => i.status === "approved" && i.grounded);
    if (!chosen.length) {
      setNotice({ tone: "info", text: "Select at least one idea to generate cards." });
      return;
    }
    await runTask(`Designing cards for ${chosen.length} idea${chosen.length === 1 ? "" : "s"}`, ["designing_prompts", "checking_quality"], async (signal, onStage) => {
      const relevant = highlights.filter((h) => chosen.some((i) => i.evidenceHighlightIds.includes(h.id)));
      const gen = await generateCards({ provider: provider(), source, run: activeRun, ideas: chosen, highlights: relevant, mode, onStage, signal });
      await loadSourceData(source.id, gen.run.id);
      setView("cards");
    });
  }, [source, activeRun, ideas, highlights, mode, provider, runTask, loadSourceData]);

  const regenerate = useCallback(
    async (card: CardCandidate, direction: RegenerateDirection) => {
      if (!source) return;
      const idea = (await ideasForRun(card.runId)).find((i) => i.id === card.ideaId);
      if (!idea) {
        setNotice({ tone: "error", text: "The idea behind this card is no longer stored." });
        return;
      }
      await runTask("Reformulating card", [], async (signal) => {
        const siblings = cards.filter((c) => c.id !== card.id && c.status !== "rejected").map((c) => c.front);
        await regenerateCard({ provider: provider(), source, card, idea, highlights, siblingFronts: siblings, direction, signal });
        await refreshCards();
      });
    },
    [source, cards, highlights, provider, runTask, refreshCards],
  );

  const highlightSelection = useCallback(async () => {
    if (page.kind !== "ready" && page.kind !== "no_access") return;
    try {
      const h = await highlightSelectionInTab(page.tabId);
      if (!source || h.sourceId !== source.id) await attachToActiveTab();
      else await refreshHighlights();
      return h;
    } catch (err) {
      setNotice({ tone: "error", text: describeError(err) });
      return undefined;
    }
  }, [page, source, attachToActiveTab, refreshHighlights]);

  const rememberSelection = useCallback(async () => {
    const h = await highlightSelection();
    if (h) {
      const src = await getSource(h.sourceId);
      await generateFromHighlights("selection", [h], src ?? null);
    }
  }, [highlightSelection, generateFromHighlights]);

  const removeHighlight = useCallback(
    async (h: Highlight) => {
      await deleteHighlight(h.id);
      if (page.kind === "ready") await sendToContent(page.tabId, { type: "REMOVE_HIGHLIGHT", highlightId: h.id }).catch(() => {});
      await refreshHighlights();
    },
    [page, refreshHighlights],
  );

  const scrollToHighlight = useCallback(
    async (h: Highlight) => {
      if (page.kind === "ready") await sendToContent(page.tabId, { type: "SCROLL_TO_HIGHLIGHT", highlightId: h.id }).catch(() => {});
    },
    [page],
  );

  const updateHighlightNote = useCallback(
    async (h: Highlight, note: string) => {
      await putHighlight({ ...h, userNote: note.trim() || null });
      await refreshHighlights();
    },
    [refreshHighlights],
  );

  const toggleIdea = useCallback(async (idea: Idea) => {
    const updated: Idea = { ...idea, status: idea.status === "approved" ? "rejected" : "approved" };
    await putIdeas([updated]);
    setIdeas((list) => list.map((i) => (i.id === idea.id ? updated : i)));
  }, []);

  const updateCard = useCallback(async (card: CardCandidate, patch: Partial<CardCandidate>) => {
    const next: CardCandidate = { ...card, ...patch, updatedAt: Date.now() };
    const textChanged = (patch.front !== undefined && patch.front !== card.front) || (patch.back !== undefined && patch.back !== card.back);
    if (textChanged) {
      next.editedByUser = next.front !== card.originalFront || next.back !== card.originalBack;
      if (card.status === "exported") next.editedAfterExport = true;
    }
    await putCard(next);
    setCards((list) => list.map((c) => (c.id === card.id ? next : c)));
  }, []);

  const keepAllSuggested = useCallback(async () => {
    const changed = cards.filter((c) => c.status === "suggested").map((c) => ({ ...c, status: "approved" as const, updatedAt: Date.now() }));
    await putCards(changed);
    await refreshCards();
  }, [cards, refreshCards]);

  const openSource = useCallback(
    async (sourceId: string) => {
      await loadSourceData(sourceId);
      setPage({ kind: "detached" });
      setView("home");
    },
    [loadSourceData],
  );

  const submitPaste = useCallback(
    async (input: { title: string; author: string; url: string; text: string; kind: "pasted_highlights" | "pasted_text"; passages: { text: string; note: string | null }[] }) => {
      const { source: src, highlights: hl } = await createPastedSource({
        title: input.title.trim(),
        author: input.author.trim() || null,
        url: input.url.trim() || null,
        kind: input.kind,
        text: input.text,
        passages: input.passages,
      });
      await loadSourceData(src.id);
      setPage({ kind: "detached" });
      await generateFromHighlights("highlights", hl, src);
    },
    [loadSourceData, generateFromHighlights],
  );

  const renameSource = useCallback(async (patch: Partial<Pick<Source, "title" | "author">>) => {
    if (!source) return;
    const next = { ...source, ...patch, updatedAt: Date.now() };
    await putSource(next);
    setSource(next);
  }, [source]);

  // Pending "Highlight + remember" requests from the context menu / shortcut.
  const handlePending = useCallback(async () => {
    const { pendingRemember } = (await chrome.storage.session.get("pendingRemember")) as { pendingRemember?: PendingRemember };
    if (!pendingRemember || busyRef.current) return;
    await chrome.storage.session.remove("pendingRemember");
    if (Date.now() - pendingRemember.at > 120_000) return;
    const [src, hl] = await Promise.all([getSource(pendingRemember.sourceId), highlightsForSource(pendingRemember.sourceId)]);
    const h = hl.find((x) => x.id === pendingRemember.highlightId);
    if (!src || !h) return;
    await loadSourceData(src.id);
    await generateFromHighlights("selection", [h], src);
  }, [loadSourceData, generateFromHighlights]);

  // Keep listeners stable (subscribed once) while always calling the latest handlers.
  const handlers = useRef({ attachToActiveTab, handlePending, refreshHighlights });
  handlers.current = { attachToActiveTab, handlePending, refreshHighlights };

  useEffect(() => {
    const h = () => handlers.current;
    void h().attachToActiveTab().then(() => h().handlePending());
    const onMessage = (msg: PanelEvent) => {
      if (msg.type === "PANEL_ACTIVATE") void h().attachToActiveTab();
      else if (msg.type === "HIGHLIGHTS_CHANGED") {
        if (msg.sourceId === sourceIdRef.current) void h().refreshHighlights();
        else void h().attachToActiveTab();
      } else if (msg.type === "HIGHLIGHT_FAILED") setNotice({ tone: "error", text: msg.error });
    };
    // Automatic re-attachment is skipped while the reader is looking at a pasted/library source.
    const onActivated = () => {
      if (pageKindRef.current !== "detached") void h().attachToActiveTab();
    };
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      const followed = tab.active || tab.id === Number(new URLSearchParams(location.search).get("tabId"));
      if (followed && info.status === "complete" && pageKindRef.current !== "detached") void h().attachToActiveTab();
    };
    const onSession = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes.pendingRemember?.newValue) void h().handlePending();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.storage.onChanged.addListener(onSession);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.storage.onChanged.removeListener(onSession);
    };
  }, []);

  return {
    settings,
    page,
    source,
    highlights,
    cards,
    runs,
    activeRun,
    ideas,
    view,
    setView,
    busy,
    notice,
    setNotice,
    mode,
    setMode,
    online,
    cancel,
    attachToActiveTab,
    analyzeArticle,
    generateFromHighlights,
    generateForIdeas,
    regenerate,
    highlightSelection,
    rememberSelection,
    removeHighlight,
    scrollToHighlight,
    updateHighlightNote,
    toggleIdea,
    updateCard,
    keepAllSuggested,
    refreshCards,
    openSource,
    submitPaste,
    renameSource,
    selectRun: (run: GenerationRun) => void loadSourceData(run.sourceId, run.id),
  };
}

export type Reader = ReturnType<typeof useReader>;
