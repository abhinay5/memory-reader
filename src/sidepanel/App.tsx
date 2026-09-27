import { Progress } from "./components/Progress";
import { useReader } from "./useReader";
import { CardsView } from "./views/CardsView";
import { HomeView } from "./views/HomeView";
import { IdeasView } from "./views/IdeasView";
import { LibraryView } from "./views/LibraryView";
import { PasteView } from "./views/PasteView";

export function App() {
  const reader = useReader();
  const { view, setView, busy, notice, setNotice, settings, source } = reader;

  const nav = (
    <nav className="topnav" aria-label="Sections">
      <button type="button" className={view === "home" ? "on" : ""} onClick={() => setView("home")} disabled={!!busy}>
        Source
      </button>
      {reader.activeRun && (
        <button type="button" className={view === "ideas" ? "on" : ""} onClick={() => setView("ideas")} disabled={!!busy}>
          Ideas
        </button>
      )}
      {source && reader.cards.length > 0 && (
        <button type="button" className={view === "cards" ? "on" : ""} onClick={() => setView("cards")} disabled={!!busy}>
          Cards <span className="count">{reader.cards.filter((c) => c.status !== "rejected").length}</span>
        </button>
      )}
      <span className="spacer" />
      <button type="button" className={view === "library" ? "on" : ""} onClick={() => setView("library")} disabled={!!busy} title="Your sources">
        Library
      </button>
      <button type="button" className="icon" onClick={() => chrome.runtime.openOptionsPage()} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65a7.3 7.3 0 0 0 1.69-.98l2.49 1.01c.22.08.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.66Z"
          />
        </svg>
      </button>
    </nav>
  );

  return (
    <div className="app">
      {nav}
      {settings && !settings.anthropicApiKey && (
        <div className="notice info" role="status">
          Add your Anthropic API key in{" "}
          <button type="button" className="link" onClick={() => chrome.runtime.openOptionsPage()}>
            Settings
          </button>{" "}
          to generate ideas and cards.
        </div>
      )}
      {!reader.online && (
        <div className="notice info" role="status">
          You're offline. Highlights, saved cards, editing and CSV export still work.
        </div>
      )}
      {notice && (
        <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" className="icon dismiss" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      <main>
        {busy ? (
          <Progress busy={busy} onCancel={reader.cancel} />
        ) : view === "ideas" ? (
          <IdeasView reader={reader} />
        ) : view === "cards" ? (
          <CardsView reader={reader} />
        ) : view === "paste" ? (
          <PasteView reader={reader} />
        ) : view === "library" ? (
          <LibraryView reader={reader} />
        ) : (
          <HomeView reader={reader} />
        )}
      </main>
    </div>
  );
}
