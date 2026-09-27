import { useState } from "react";
import type { GenerationRun, Highlight, Idea } from "../../types";
import { ModeSelector } from "../components/ModeSelector";
import type { Reader } from "../useReader";

const EPISTEMIC_LABEL: Record<Idea["epistemicStatus"], string> = {
  established_fact: "fact",
  author_claim: "author's claim",
  argument: "argument",
  interpretation: "interpretation",
  speculation: "speculation",
  reported_claim: "reported claim",
  quotation: "quotation",
  historical_claim: "historical claim",
  definition: "definition",
};

export function InterpretationSummary({ run, ideas, highlights }: { run: GenerationRun; ideas: Idea[]; highlights: Highlight[] }) {
  const [open, setOpen] = useState(false);
  if (run.highlightIds.length === 0) return null;
  const byId = new Map(highlights.map((h) => [h.id, h]));
  const count = (d: string) => run.interpretations.filter((i) => i.disposition === d).length;
  const merged = count("merged");
  const context = count("supporting_context");
  const notWorth = count("not_worth_retaining");
  const unclear = run.interpretations.filter((i) => i.disposition === "insufficient_context");
  const ideaTitle = new Map(ideas.map((i) => [i.id, i.statement]));
  const cards = run.cardCandidateIds.length;
  const s = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const was = (n: number, word: string) => `${s(n, word)} ${n === 1 ? "was" : "were"}`;

  return (
    <section className="interpretation">
      <p className="flow">
        {s(run.highlightIds.length, "highlight")} → {s(ideas.length, "idea")} worth retaining
        {cards > 0 && <> → {s(cards, "candidate card")}</>}
      </p>
      <ul className="facts">
        {merged > 0 && <li>{was(merged, "highlight")} merged into another highlight's idea.</li>}
        {context > 0 && <li>{s(context, "highlight")} provided supporting context only.</li>}
        {notWorth > 0 && <li>{was(notWorth, "highlight")} not turned into cards — not worth long-term review.</li>}
        {run.stats.cardsDroppedByReview > 0 && <li>Quality check dropped {s(run.stats.cardsDroppedByReview, "weak card")}.</li>}
        {run.stats.cardsRevisedByReview > 0 && <li>Quality check reformulated {s(run.stats.cardsRevisedByReview, "card")}.</li>}
        {run.stats.duplicatesRemoved > 0 && <li>{s(run.stats.duplicatesRemoved, "duplicate")} removed.</li>}
      </ul>
      {unclear.length > 0 && (
        <div className="notice info">
          {unclear.length === 1 ? "One passage appears" : `${unclear.length} passages appear`} to depend on context that wasn't captured, so no meaning was invented for {unclear.length === 1 ? "it" : "them"}. Highlight a
          little more of the surrounding text and try again, or skip.
        </div>
      )}
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "How were my highlights interpreted?"}
      </button>
      {open && (
        <ol className="interpretations">
          {run.interpretations.map((i) => (
            <li key={i.highlightId}>
              <blockquote>{byId.get(i.highlightId)?.exactText ?? "(highlight removed)"}</blockquote>
              <p>
                <strong>{i.disposition.replace(/_/g, " ")}</strong>
                {i.relation !== "core" && i.relation !== "context_only" && <> · {i.relation.replace(/_/g, " ")}</>}
                {i.ideaIds.length > 0 && <> → {i.ideaIds.map((id) => ideaTitle.get(id)).filter(Boolean).join("; ")}</>}
              </p>
              {i.note && <p className="hint">{i.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function IdeaItem({ idea, highlights, onToggle }: { idea: Idea; highlights: Map<string, Highlight>; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const selected = idea.status === "approved";
  return (
    <li className={`idea ${selected ? "selected" : ""} ${idea.grounded ? "" : "ungrounded"}`}>
      <div className="idea-head">
        <input type="checkbox" id={`idea-${idea.id}`} checked={selected} disabled={!idea.grounded} onChange={onToggle} />
        <label htmlFor={`idea-${idea.id}`}>{idea.statement}</label>
      </div>
      <p className="tags">
        <span>{idea.ideaType.replace(/_/g, " ")}</span>
        <span>{EPISTEMIC_LABEL[idea.epistemicStatus]}</span>
        {idea.centrality === "central" && <span className="central">central</span>}
        {idea.evidenceHighlightIds.length > 0 && <span className="hl">highlighted ×{idea.evidenceHighlightIds.length}</span>}
      </p>
      {!idea.grounded && <p className="warn">No supporting passage could be found in the source, so this idea won't become a card.</p>}
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Less" : "Why it matters & evidence"}
      </button>
      {open && (
        <div className="idea-detail">
          <p>{idea.explanation}</p>
          <p className="hint">Why it matters: {idea.importanceReason}</p>
          {idea.evidencePassages.map((p, i) => (
            <blockquote key={i}>{p}</blockquote>
          ))}
          {idea.evidenceHighlightIds
            .map((id) => highlights.get(id))
            .filter((h): h is Highlight => !!h && !idea.evidencePassages.includes(h.exactText))
            .map((h) => (
              <blockquote key={h.id} className="from-highlight">
                {h.exactText}
              </blockquote>
            ))}
        </div>
      )}
    </li>
  );
}

export function IdeasView({ reader }: { reader: Reader }) {
  const { activeRun, ideas, highlights, mode, setMode, runs } = reader;
  if (!activeRun) return <p className="hint pad">No analysis yet.</p>;
  const hById = new Map(highlights.map((h) => [h.id, h]));
  const selected = ideas.filter((i) => i.status === "approved" && i.grounded).length;
  const ordered = [...ideas].sort((a, b) => ["central", "supporting", "peripheral"].indexOf(a.centrality) - ["central", "supporting", "peripheral"].indexOf(b.centrality));
  const aiReady = !!reader.settings?.anthropicApiKey && reader.online;

  return (
    <div className="ideas-view">
      {runs.length > 1 && (
        <label className="run-picker">
          <span>Analysis</span>
          <select
            value={activeRun.id}
            onChange={(e) => {
              const r = runs.find((x) => x.id === e.target.value);
              if (r) reader.selectRun(r);
            }}
          >
            {[...runs].reverse().map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })} — {r.scope}
              </option>
            ))}
          </select>
        </label>
      )}
      {activeRun.thesis && (
        <section className="thesis">
          <h2>{activeRun.scope === "selection" ? "What this passage is doing" : "Main idea"}</h2>
          <p>{activeRun.thesis}</p>
          {activeRun.summary && <p className="hint">{activeRun.summary}</p>}
        </section>
      )}
      <InterpretationSummary run={activeRun} ideas={ideas} highlights={highlights} />
      <section>
        <h2>Ideas worth remembering</h2>
        {ideas.length === 0 ? (
          <p className="hint">No ideas here seemed worth long-term memory.</p>
        ) : (
          <ul className="ideas">
            {ordered.map((idea) => (
              <IdeaItem key={idea.id} idea={idea} highlights={hById} onToggle={() => void reader.toggleIdea(idea)} />
            ))}
          </ul>
        )}
      </section>
      {ideas.length > 0 && (
        <section className="generate sticky">
          <ModeSelector value={mode} onChange={setMode} />
          <button type="button" className="primary" disabled={!selected || !aiReady} onClick={() => void reader.generateForIdeas()}>
            Generate cards for {selected} idea{selected === 1 ? "" : "s"}
          </button>
        </section>
      )}
    </div>
  );
}
