import { useEffect, useMemo, useState } from "react";
import type { RegenerateDirection } from "../../ai/prompts";
import { FLAG_LABELS } from "../../ai/validate-card";
import { MochiClient } from "../../mochi/api";
import { cardsToCsv, downloadCsv } from "../../mochi/csv";
import { exportCardsToMochi, type ExportResult } from "../../mochi/export";
import { ideasForSource } from "../../storage/db";
import { saveSettings } from "../../storage/settings";
import type { CardCandidate, Idea, MochiDeck } from "../../types";
import { slugify } from "../../utils/text";
import type { Reader } from "../useReader";
import { InterpretationSummary } from "./IdeasView";

const REGEN_OPTIONS: { value: RegenerateDirection; label: string }[] = [
  { value: "rephrase", label: "Rephrase" },
  { value: "simpler", label: "Simpler" },
  { value: "more_conceptual", label: "More conceptual" },
  { value: "more_precise", label: "More precise" },
  { value: "different_angle", label: "Different angle" },
];

function AutoTextarea(props: { id: string; label: string; value: string; onCommit: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <div className={`field ${props.className ?? ""}`}>
      <label htmlFor={props.id}>{props.label}</label>
      <textarea
        id={props.id}
        value={draft}
        rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 42) + draft.split("\n").length - 1))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== props.value && draft.trim() && props.onCommit(draft.trim())}
      />
    </div>
  );
}

function CardItem({ card, idea, reader, disabled }: { card: CardCandidate; idea: Idea | undefined; reader: Reader; disabled: boolean }) {
  const [showSource, setShowSource] = useState(false);
  const exported = card.status === "exported";
  const flags = card.qualityFlags.filter((f) => FLAG_LABELS[f]);
  return (
    <li className={`card status-${card.status}`}>
      <AutoTextarea id={`front-${card.id}`} label="Prompt" value={card.front} onCommit={(front) => void reader.updateCard(card, { front })} className="front" />
      <AutoTextarea id={`back-${card.id}`} label="Answer" value={card.back} onCommit={(back) => void reader.updateCard(card, { back })} />
      {flags.length > 0 && (
        <ul className="flags" aria-label="Quality notes">
          {flags.map((f) => (
            <li key={f}>{FLAG_LABELS[f]}</li>
          ))}
        </ul>
      )}
      <div className="based-on">
        <button type="button" className="link" aria-expanded={showSource} onClick={() => setShowSource(!showSource)}>
          Based on: {idea ? idea.statement : "idea"}
        </button>
        {showSource && card.sourceEvidence && <blockquote>{card.sourceEvidence}</blockquote>}
      </div>
      <div className="card-actions">
        {exported ? (
          <>
            <span className="sent">Sent ✓</span>
            {card.editedAfterExport && <span className="hint">Edited after sending — use “Send as new card” below to add the new version.</span>}
          </>
        ) : (
          <>
            <button
              type="button"
              className={card.status === "approved" ? "on" : ""}
              aria-pressed={card.status === "approved"}
              disabled={disabled}
              onClick={() => void reader.updateCard(card, { status: card.status === "approved" ? "suggested" : "approved" })}
            >
              {card.status === "approved" ? "Kept ✓" : card.status === "failed" ? "Kept (send failed)" : "Keep"}
            </button>
            <button
              type="button"
              aria-pressed={card.status === "rejected"}
              className={card.status === "rejected" ? "on reject" : ""}
              disabled={disabled}
              onClick={() => void reader.updateCard(card, { status: card.status === "rejected" ? "suggested" : "rejected" })}
            >
              {card.status === "rejected" ? "Rejected" : "Reject"}
            </button>
            <label className="regen">
              <span className="sr-only">Regenerate</span>
              <select
                value=""
                disabled={disabled || !reader.online || !reader.settings?.anthropicApiKey}
                onChange={(e) => e.target.value && void reader.regenerate(card, e.target.value as RegenerateDirection)}
              >
                <option value="">Regenerate…</option>
                {REGEN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </li>
  );
}

const DECKS_CACHE = "decksCache";

export function CardsView({ reader }: { reader: Reader }) {
  const { cards, source, settings, activeRun, highlights, ideas: runIdeas } = reader;
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [decks, setDecks] = useState<MochiDeck[]>([]);
  const [deckId, setDeckId] = useState<string>("");
  const [deckError, setDeckError] = useState<string | null>(null);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    if (source) void ideasForSource(source.id).then(setIdeas);
  }, [source, cards.length]);

  useEffect(() => {
    if (!settings) return;
    setDeckId((d) => d || settings.defaultDeckId || "");
    void chrome.storage.local.get(DECKS_CACHE).then((r) => {
      const cached = r[DECKS_CACHE] as MochiDeck[] | undefined;
      if (cached?.length) setDecks(cached);
    });
    if (!settings.mochiApiKey || !navigator.onLine) return;
    new MochiClient(settings.mochiApiKey)
      .listDecks()
      .then((list) => {
        setDecks(list);
        setDeckError(null);
        void chrome.storage.local.set({ [DECKS_CACHE]: list });
      })
      .catch((err: Error) => setDeckError(err.message));
  }, [settings]);

  const ideaById = useMemo(() => new Map(ideas.map((i) => [i.id, i])), [ideas]);
  const toReview = cards.filter((c) => c.status === "suggested");
  const kept = cards.filter((c) => c.status === "approved" || c.status === "failed");
  const sent = cards.filter((c) => c.status === "exported");
  const rejected = cards.filter((c) => c.status === "rejected");
  const editedSent = sent.filter((c) => c.editedAfterExport);
  const deck = decks.find((d) => d.id === deckId) ?? (deckId && settings?.defaultDeckId === deckId ? { id: deckId, name: settings.defaultDeckName ?? "Mochi deck" } : null);

  if (!source) return <p className="hint pad">No source selected.</p>;

  const send = async (list: CardCandidate[], forceNew = false) => {
    if (!settings?.mochiApiKey) {
      setResult(null);
      reader.setNotice({ tone: "error", text: "Add your Mochi API key in Settings, or export these cards as CSV." });
      return;
    }
    if (!deck) {
      reader.setNotice({ tone: "error", text: "Choose a Mochi deck first." });
      return;
    }
    setResult(null);
    setSending({ done: 0, total: list.length });
    try {
      const res = await exportCardsToMochi(
        new MochiClient(settings.mochiApiKey),
        list.map((card) => ({ card, source })),
        deck,
        { includeSourceLink: settings.includeSourceLink, autoSourceTags: settings.autoSourceTags, forceNew },
        (done, total) => setSending({ done, total }),
      );
      setResult(res);
      if (deck.id !== settings.defaultDeckId) await saveSettings({ defaultDeckId: deck.id, defaultDeckName: deck.name });
    } finally {
      setSending(null);
      await reader.refreshCards();
    }
  };

  const exportCsv = (list: CardCandidate[], suffix = "") => {
    if (!list.length) return;
    const csv = cardsToCsv(
      list.map((card) => ({ card, source })),
      { includeSourceLink: settings?.includeSourceLink ?? true },
    );
    downloadCsv(`${slugify(source.title) || "cards"}${suffix}.csv`, csv);
  };

  const busy = !!sending;
  const section = (title: string, list: CardCandidate[]) =>
    list.length > 0 && (
      <section>
        <h2>
          {title} <span className="count">{list.length}</span>
        </h2>
        <ol className="cards">
          {list.map((c) => (
            <CardItem key={c.id} card={c} idea={ideaById.get(c.ideaId)} reader={reader} disabled={busy} />
          ))}
        </ol>
      </section>
    );

  return (
    <div className="cards-view">
      {activeRun && activeRun.cardCandidateIds.length > 0 && <InterpretationSummary run={activeRun} ideas={runIdeas} highlights={highlights} />}

      {toReview.length > 1 && (
        <div className="bulk">
          <button type="button" onClick={() => void reader.keepAllSuggested()} disabled={busy}>
            Keep all {toReview.length} to review
          </button>
        </div>
      )}
      {section("To review", toReview)}
      {section("Kept", kept)}
      {section("Sent to Mochi", sent)}
      {rejected.length > 0 && (
        <section>
          <button type="button" className="link" aria-expanded={showRejected} onClick={() => setShowRejected(!showRejected)}>
            {showRejected ? "Hide" : "Show"} {rejected.length} rejected
          </button>
          {showRejected && (
            <ol className="cards">
              {rejected.map((c) => (
                <CardItem key={c.id} card={c} idea={ideaById.get(c.ideaId)} reader={reader} disabled={busy} />
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="export sticky" aria-label="Send to Mochi">
        {result && <ExportBanner result={result} deckName={deck?.name ?? "Mochi"} onRetry={(l) => void send(l)} onCsv={(l) => exportCsv(l, "-failed")} />}
        <div className="deck-row">
          <label htmlFor="deck">Deck</label>
          <select id="deck" value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={busy}>
            <option value="">{settings?.mochiApiKey ? (decks.length ? "Choose a deck…" : "Loading decks…") : "Mochi not connected"}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            {deckId && !decks.some((d) => d.id === deckId) && settings?.defaultDeckName && <option value={deckId}>{settings.defaultDeckName}</option>}
          </select>
        </div>
        {deckError && <p className="warn">{deckError}</p>}
        <div className="buttons">
          <button type="button" className="primary" disabled={busy || kept.length === 0 || !deck || !reader.online} onClick={() => void send(kept)}>
            {sending ? `Sending ${sending.done}/${sending.total}…` : kept.length ? `Send ${kept.length} card${kept.length === 1 ? "" : "s"} to Mochi` : sent.length ? "Sent ✓" : "Keep cards to send them"}
          </button>
          <button type="button" disabled={busy || kept.length + sent.length === 0} onClick={() => exportCsv([...kept, ...sent])}>
            Export CSV
          </button>
        </div>
        {editedSent.length > 0 && (
          <button type="button" className="link" disabled={busy || !deck} onClick={() => void send(editedSent, true)}>
            Send {editedSent.length} edited card{editedSent.length === 1 ? "" : "s"} as new card{editedSent.length === 1 ? "" : "s"}
          </button>
        )}
        {!settings?.mochiApiKey && <p className="hint">No Mochi API key? Export CSV and import it in Mochi (first row is a header).</p>}
      </section>
    </div>
  );
}

function ExportBanner({
  result,
  deckName,
  onRetry,
  onCsv,
}: {
  result: ExportResult;
  deckName: string;
  onRetry: (cards: CardCandidate[]) => void;
  onCsv: (cards: CardCandidate[]) => void;
}) {
  const failed = result.failed.map((f) => f.card);
  const total = result.sent.length + result.failed.length;
  if (failed.length === 0) {
    return (
      <div className="notice success" role="status">
        {result.sent.length > 0 ? `${result.sent.length} card${result.sent.length === 1 ? "" : "s"} added to ${deckName}.` : "Nothing new to send."}
        {result.skipped.length > 0 && ` ${result.skipped.length} already sent card${result.skipped.length === 1 ? " was" : "s were"} skipped.`}{" "}
        <a href="https://app.mochi.cards/" target="_blank" rel="noreferrer">
          Open Mochi
        </a>
      </div>
    );
  }
  return (
    <div className="notice error" role="alert">
      <p>{result.sent.length > 0 ? `${result.sent.length} of ${total} cards were added. ${failed.length} failed.` : result.fatal?.message ?? `${failed.length} cards failed.`}</p>
      {result.sent.length > 0 && result.fatal && <p className="hint">{result.fatal.message}</p>}
      <div className="buttons">
        <button type="button" onClick={() => onRetry(failed)}>
          Retry failed {failed.length}
        </button>
        <button type="button" onClick={() => onCsv(failed)}>
          Export failed {failed.length} as CSV
        </button>
      </div>
    </div>
  );
}
