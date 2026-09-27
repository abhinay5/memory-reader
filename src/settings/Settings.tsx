import { useEffect, useState } from "react";
import { STUDY_MODE_GUIDANCE } from "../ai/prompts";
import { testAnthropicKey } from "../ai/llm";
import { MochiClient } from "../mochi/api";
import { clearAllData, deleteSourceData, listSources } from "../storage/db";
import { DEFAULT_SETTINGS, forgetApiKeys, loadSettings, MODEL_OPTIONS, saveSettings } from "../storage/settings";
import type { MochiDeck, Settings, Source, StudyMode } from "../types";

type Status = { tone: "success" | "error" | "info"; text: string } | null;

function SecretField({ id, label, value, onSave }: { id: string; label: string; value: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(!value);
  useEffect(() => setEditing(!value), [value]);
  if (!editing) {
    return (
      <div className="field">
        <span className="label">{label}</span>
        <div className="secret">
          <code>••••••••••••{value.slice(-4)}</code>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Replace
          </button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) void onSave(draft.trim()).then(() => setDraft(""));
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="inline">
        <input id={id} type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" disabled={!draft.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [aiStatus, setAiStatus] = useState<Status>(null);
  const [mochiStatus, setMochiStatus] = useState<Status>(null);
  const [privacyStatus, setPrivacyStatus] = useState<Status>(null);
  const [decks, setDecks] = useState<MochiDeck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [customModel, setCustomModel] = useState(false);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setCustomModel(!MODEL_OPTIONS.some((m) => m.id === s.model));
    });
    void listSources().then(setSources);
  }, []);

  const update = async (patch: Partial<Settings>) => setSettings(await saveSettings(patch));

  const loadDecks = async (key = settings.mochiApiKey) => {
    if (!key) return;
    setMochiStatus({ tone: "info", text: "Connecting…" });
    try {
      const list = await new MochiClient(key).listDecks();
      setDecks(list);
      await chrome.storage.local.set({ decksCache: list });
      setMochiStatus({ tone: "success", text: `Connected — ${list.length} deck${list.length === 1 ? "" : "s"} found.` });
    } catch (err) {
      setMochiStatus({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    if (settings.mochiApiKey && decks.length === 0) void loadDecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mochiApiKey]);

  const testAi = async () => {
    setAiStatus({ tone: "info", text: "Testing…" });
    try {
      await testAnthropicKey(settings.anthropicApiKey, settings.model);
      setAiStatus({ tone: "success", text: `Connected to ${settings.model}.` });
    } catch (err) {
      setAiStatus({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const toggleAutoRestore = async (on: boolean) => {
    if (on) {
      // Must be requested from a user gesture; grants access to pages so highlights can re-render on reload.
      const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
      await update({ autoRestoreHighlights: granted });
    } else {
      await chrome.permissions.remove({ origins: ["<all_urls>"] }).catch(() => false);
      await update({ autoRestoreHighlights: false });
    }
  };

  return (
    <div className="settings">
      <h1>Memory Reader settings</h1>

      <section>
        <h2>Claude (Anthropic)</h2>
        <SecretField
          id="anthropic-key"
          label="API key"
          value={settings.anthropicApiKey}
          onSave={async (v) => {
            await update({ anthropicApiKey: v });
            setAiStatus(null);
          }}
        />
        <div className="field">
          <label htmlFor="model">Model</label>
          {customModel ? (
            <div className="inline">
              <input id="model" value={settings.model} onChange={(e) => void update({ model: e.target.value.trim() })} />
              <button type="button" className="link" onClick={() => setCustomModel(false)}>
                Choose from list
              </button>
            </div>
          ) : (
            <select
              id="model"
              value={settings.model}
              onChange={(e) => {
                if (e.target.value === "__custom") setCustomModel(true);
                else void update({ model: e.target.value });
              }}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              <option value="__custom">Other model id…</option>
            </select>
          )}
        </div>
        <div className="buttons">
          <button type="button" disabled={!settings.anthropicApiKey} onClick={() => void testAi()}>
            Test connection
          </button>
        </div>
        {aiStatus && <p className={`status ${aiStatus.tone}`}>{aiStatus.text}</p>}
        <p className="hint">The key is stored only in this browser profile and sent only to api.anthropic.com.</p>
      </section>

      <section>
        <h2>Mochi</h2>
        <SecretField
          id="mochi-key"
          label="API key"
          value={settings.mochiApiKey}
          onSave={async (v) => {
            await update({ mochiApiKey: v });
            await loadDecks(v);
          }}
        />
        <div className="buttons">
          <button type="button" disabled={!settings.mochiApiKey} onClick={() => void loadDecks()}>
            Test connection
          </button>
        </div>
        {mochiStatus && <p className={`status ${mochiStatus.tone}`}>{mochiStatus.text}</p>}
        <div className="field">
          <label htmlFor="deck">Default deck</label>
          <select
            id="deck"
            value={settings.defaultDeckId ?? ""}
            onChange={(e) => {
              const d = decks.find((x) => x.id === e.target.value);
              void update({ defaultDeckId: d?.id ?? null, defaultDeckName: d?.name ?? null });
            }}
            disabled={decks.length === 0}
          >
            <option value="">{decks.length ? "Choose a deck…" : settings.defaultDeckName ?? "Connect Mochi to list decks"}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">Find your API key in Mochi → Account settings → API Keys. Cards are created with the prompt on the front and the answer (plus source link) on the back.</p>
      </section>

      <section>
        <h2>Generation</h2>
        <div className="field">
          <label htmlFor="mode">Default study mode</label>
          <select id="mode" value={settings.studyMode} onChange={(e) => void update({ studyMode: e.target.value as StudyMode })}>
            {(Object.keys(STUDY_MODE_GUIDANCE) as StudyMode[]).map((m) => (
              <option key={m} value={m}>
                {STUDY_MODE_GUIDANCE[m].label} — {STUDY_MODE_GUIDANCE[m].description}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.autoSourceTags} onChange={(e) => void update({ autoSourceTags: e.target.checked })} />
          Automatic source tags (author, publication)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.includeSourceLink} onChange={(e) => void update({ includeSourceLink: e.target.checked })} />
          Include source link on cards
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.autoRestoreHighlights} onChange={(e) => void toggleAutoRestore(e.target.checked)} />
          Show my highlights automatically when I revisit a page
        </label>
        <p className="hint">
          Off by default: the extension only reads a page when you click it. Turning this on asks Chrome for permission to read pages so saved highlights can reappear on reload. Only pages you have highlighted are
          touched.
        </p>
      </section>

      <section>
        <h2>Privacy</h2>
        <p className="hint">Everything is stored locally in this browser. Article text leaves the browser only when you ask for analysis or cards, and only to Anthropic.</p>
        {sources.length > 0 && (
          <details>
            <summary>Stored sources ({sources.length})</summary>
            <ul className="source-list">
              {sources.map((s) => (
                <li key={s.id}>
                  <span>{s.title}</span>
                  <button
                    type="button"
                    className="link danger"
                    onClick={async () => {
                      if (!confirm("This removes local source data only. Cards already sent to Mochi will remain there.")) return;
                      await deleteSourceData(s.id);
                      setSources(await listSources());
                    }}
                  >
                    Delete source data
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="buttons">
          <button
            type="button"
            onClick={async () => {
              if (!confirm("Delete all sources, highlights, ideas and cards stored in this browser? Cards already in Mochi stay there.")) return;
              await clearAllData();
              setSources([]);
              setPrivacyStatus({ tone: "success", text: "Reading data cleared." });
            }}
          >
            Clear reading data
          </button>
          <button
            type="button"
            onClick={async () => {
              await forgetApiKeys();
              await chrome.storage.local.remove("decksCache");
              setSettings(await loadSettings());
              setDecks([]);
              setPrivacyStatus({ tone: "success", text: "API keys forgotten." });
            }}
          >
            Forget API keys
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (!confirm("Delete ALL local data, including API keys and settings?")) return;
              await clearAllData();
              await chrome.storage.local.clear();
              setSettings(await loadSettings());
              setSources([]);
              setDecks([]);
              setPrivacyStatus({ tone: "success", text: "All local data cleared." });
            }}
          >
            Clear all local data
          </button>
        </div>
        {privacyStatus && <p className={`status ${privacyStatus.tone}`}>{privacyStatus.text}</p>}
      </section>

      <section>
        <h2>Shortcuts</h2>
        <p className="hint">
          Set keyboard shortcuts for “Open Memory Reader”, “Highlight the selected text” and “Highlight … and make cards” at <code>chrome://extensions/shortcuts</code>. Right-clicking selected text also offers both actions.
        </p>
      </section>
    </div>
  );
}
