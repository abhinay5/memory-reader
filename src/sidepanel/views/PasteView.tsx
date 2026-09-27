import { useMemo, useState } from "react";
import { parsePastedHighlights } from "../../core/paste";
import { ModeSelector } from "../components/ModeSelector";
import type { Reader } from "../useReader";

export function PasteView({ reader }: { reader: Reader }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const passages = useMemo(() => parsePastedHighlights(text), [text]);
  const aiReady = !!reader.settings?.anthropicApiKey && reader.online;

  return (
    <form
      className="paste"
      onSubmit={(e) => {
        e.preventDefault();
        if (!passages.length || !title.trim()) return;
        void reader.submitPaste({ title, author, url, text, kind: "pasted_highlights", passages });
      }}
    >
      <h1>Paste highlights</h1>
      <p className="hint">Kindle highlights, book notes, PDF highlights or copied excerpts. Separate passages with a blank line; a line starting with “Note:” attaches your note to the passage above.</p>
      <div className="field">
        <label htmlFor="p-title">Title (book or article)</label>
        <input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-author">Author (optional)</label>
        <input id="p-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-url">Source URL (optional)</label>
        <input id="p-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </div>
      <div className="field">
        <label htmlFor="p-text">Highlights</label>
        <textarea id="p-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <p className="hint">{passages.length ? `${passages.length} passage${passages.length === 1 ? "" : "s"} detected.` : "No passages yet."}</p>
      <ModeSelector value={reader.mode} onChange={reader.setMode} />
      <div className="buttons">
        <button type="submit" className="primary" disabled={!passages.length || !title.trim() || !aiReady}>
          Generate from {passages.length || ""} highlight{passages.length === 1 ? "" : "s"}
        </button>
        <button type="button" onClick={() => reader.setView("home")}>
          Cancel
        </button>
      </div>
      <p className="privacy">These passages are sent to Anthropic to find ideas and design cards.</p>
    </form>
  );
}
