import type { Settings } from "../types";

// Lightweight preferences and secrets live in chrome.storage.local (never .sync):
// they stay on this device and are only ever sent to the provider they belong to.

export const DEFAULT_MODEL = "claude-sonnet-5";

export const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced (recommended)" },
  { id: "claude-opus-5", label: "Claude Opus 5 — highest quality, slower" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, weaker judgment" },
];

export const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: "",
  model: DEFAULT_MODEL,
  mochiApiKey: "",
  defaultDeckId: null,
  defaultDeckName: null,
  studyMode: "understand",
  autoSourceTags: true,
  includeSourceLink: true,
  autoRestoreHighlights: false,
};

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) listener({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue ?? {}) });
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export async function forgetApiKeys(): Promise<void> {
  await saveSettings({ anthropicApiKey: "", mochiApiKey: "", defaultDeckId: null, defaultDeckName: null });
}
