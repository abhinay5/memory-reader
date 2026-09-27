import { useState } from "react";
import type { Highlight } from "../../types";
import { ModeSelector } from "../components/ModeSelector";
import type { Reader } from "../useReader";

function HighlightItem({ h, reader, canScroll }: { h: Highlight; reader: Reader; canScroll: boolean }) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(h.userNote ?? "");
  return (
    <li className="highlight">
      <blockquote>{h.exactText}</blockquote>
      <div className="meta">
        {h.sectionHeading && <span>§ {h.sectionHeading}</span>}
        {h.anchorStatus === "unavailable" && h.anchorData && <span className="warn">Source location unavailable</span>}
      </div>
      {h.userNote && !editingNote && <p className="note">{h.userNote}</p>}
      {editingNote && (
        <div className="note-edit">
          <label className="sr-only" htmlFor={`note-${h.id}`}>
            Note
          </label>
          <textarea id={`note-${h.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this matters to you (optional)" />
          <button
            type="button"
            className="small"
            onClick={() => {
              void reader.updateHighlightNote(h, note);
              setEditingNote(false);
            }}
          >
            Save note
          </button>
        </div>
      )}
      <div className="row-actions">
        {canScroll && h.anchorStatus !== "unavailable" && (
          <button type="button" className="link" onClick={() => void reader.scrollToHighlight(h)}>
            Show
          </button>
        )}
        <button type="button" className="link" onClick={() => setEditingNote((v) => !v)}>
          {h.userNote ? "Edit note" : "Add note"}
        </button>
        <button type="button" className="link" onClick={() => void reader.generateFromHighlights("selection", [h])} disabled={!reader.online}>
          Remember this
        </button>
        <button type="button" className="link danger" onClick={() => void reader.removeHighlight(h)}>
          Remove
        </button>
      </div>
    </li>
  );
}

export function HomeView({ reader }: { reader: Reader }) {
  const { page, source, highlights, cards, mode, setMode, online, setView } = reader;
  const aiReady = !!reader.settings?.anthropicApiKey && online;

  if (page.kind === "loading" && !source) return <p className="hint pad">Reading this page…</p>;

  const pageHelp =
    page.kind === "unsupported" ? (
      <div className="empty">
        <h1>Nothing to read here</h1>
        <p>Open an article to highlight and remember it, or paste highlights from a book or PDF.</p>
      </div>
    ) : page.kind === "no_access" ? (
      <div className="notice info">Click the Memory Reader icon in the toolbar to let it read this page.</div>
    ) : page.kind === "error" ? (
      <div className="notice error">
        This page couldn't be read: {page.message}{" "}
        <button type="button" className="link" onClick={() => void reader.attachToActiveTab()}>
          Try again
        </button>
      </div>
    ) : null;

  const exported = cards.filter((c) => c.status === "exported").length;
  const pending = cards.filter((c) => c.status === "suggested" || c.status === "approved" || c.status === "failed").length;
  const canHighlight = page.kind === "ready";

  return (
    <div className="home">
      {pageHelp}
      {source && (
        <header className="source">
          <h1>{source.title}</h1>
          <p className="byline">{[source.author, source.site].filter(Boolean).join(" · ") || " "}</p>
          <p className="stats">
            {source.wordCount > 0 && <span>{source.wordCount.toLocaleString()} words</span>}
            <span>
              {highlights.length} highlight{highlights.length === 1 ? "" : "s"}
            </span>
            {page.kind === "detached" && (
              <button type="button" className="link" onClick={() => void reader.attachToActiveTab()}>
                Back to current tab
              </button>
            )}
          </p>
          {source.sourceType === "web_article" && source.wordCount > 0 && source.wordCount < 150 && (
            <p className="hint">Only a little text was found on this page — it may not be an article.</p>
          )}
        </header>
      )}

      {source && (
        <section className="actions">
          {highlights.length > 0 && <ModeSelector value={mode} onChange={setMode} />}
          <div className="buttons">
            {highlights.length > 0 && (
              <button type="button" className="primary" disabled={!aiReady} onClick={() => void reader.generateFromHighlights("highlights", highlights)}>
                Generate from {highlights.length} highlight{highlights.length === 1 ? "" : "s"}
              </button>
            )}
            {source.sourceType === "web_article" && source.wordCount > 0 && (
              <button type="button" className={highlights.length ? "" : "primary"} disabled={!aiReady} onClick={() => void reader.analyzeArticle()}>
                Analyze article
              </button>
            )}
          </div>
          {canHighlight && (
            <div className="buttons secondary">
              <button type="button" onClick={() => void reader.highlightSelection()}>
                Highlight selection
              </button>
              <button type="button" disabled={!aiReady} onClick={() => void reader.rememberSelection()}>
                Highlight + remember
              </button>
            </div>
          )}
          <p className="privacy">Article text is sent to Anthropic only when you choose one of these actions.</p>
        </section>
      )}

      {cards.length > 0 && (
        <button type="button" className="summary-link" onClick={() => setView("cards")}>
          {pending > 0 ? `${pending} card${pending === 1 ? "" : "s"} to review` : "Review cards"}
          {exported > 0 && ` · ${exported} sent to Mochi`} →
        </button>
      )}

      {highlights.length > 0 && (
        <section>
          <h2>Highlights</h2>
          <ol className="highlights">
            {highlights.map((h) => (
              <HighlightItem key={h.id} h={h} reader={reader} canScroll={canHighlight} />
            ))}
          </ol>
        </section>
      )}

      {source && highlights.length === 0 && source.sourceType === "web_article" && (
        <p className="hint">Tip: select text on the page, then right-click → “Highlight selection”. Read normally; generate cards when you finish.</p>
      )}

      <div className="footer-actions">
        <button type="button" className="link" onClick={() => setView("paste")}>
          Paste highlights from a book or PDF
        </button>
      </div>
    </div>
  );
}
