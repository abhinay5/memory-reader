import { cardsForSource, putCard, putCards, putIdeas, putRun, putSource } from "../storage/db";
import type { CardCandidate, GenerationRun, GenerationScope, Highlight, HighlightInterpretation, Idea, Source, StudyMode } from "../types";
import { hashString, newId } from "../utils/hashing";
import { isExcerptGrounded } from "../utils/text";
import type { RegenerateDirection } from "./prompts";
import { cardBudget, type AIProvider, type DraftCard } from "./provider";
import { duplicateIndices, isBlocking, qualityFlags } from "./validate-card";

// Orchestrates the two-stage pipeline (Source → Ideas, then Ideas → Cards → quality review)
// and persists every intermediate result so that no failure destroys earlier work.

export type PipelineStage = "reading" | "finding_ideas" | "designing_prompts" | "checking_quality";

export const STAGE_LABELS: Record<PipelineStage, string> = {
  reading: "Reading the source",
  finding_ideas: "Finding the ideas worth keeping",
  designing_prompts: "Designing prompts",
  checking_quality: "Checking card quality",
};

const CENTRALITY_RANK = { central: 0, supporting: 1, peripheral: 2 } as const;
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

function groundingCorpus(source: Source, highlights: Highlight[]): string {
  const parts = [source.extractedText];
  for (const h of highlights) parts.push(h.exactText, h.paragraph, h.contextBefore, h.contextAfter);
  return parts.filter(Boolean).join("\n\n");
}

export interface AnalysisOutcome {
  run: GenerationRun;
  ideas: Idea[];
}

export async function analyzeSource(opts: {
  provider: AIProvider;
  source: Source;
  highlights: Highlight[];
  scope: GenerationScope;
  mode: StudyMode;
  onStage?: (stage: PipelineStage) => void;
  signal?: AbortSignal;
}): Promise<AnalysisOutcome> {
  const { provider, source, highlights, scope, mode, onStage, signal } = opts;
  const result = await provider.analyzeSource({ source, highlights, scope, mode, signal, onProgress: (s) => onStage?.(s) });

  const now = Date.now();
  const runId = newId("run");
  const corpus = groundingCorpus(source, highlights);
  const highlightIds = new Set(highlights.map((h) => h.id));
  const keyToId = new Map<string, string>();

  const ideas: Idea[] = result.ideas.map((draft, i) => {
    const id = newId("idea");
    keyToId.set(draft.key, id);
    const evidenceHighlightIds = [...new Set(draft.evidence.map((e) => e.highlightId).filter((h): h is string => !!h && highlightIds.has(h)))];
    const evidencePassages = draft.evidence.map((e) => e.excerpt.trim()).filter(Boolean);
    const grounded = evidenceHighlightIds.length > 0 || evidencePassages.some((p) => isExcerptGrounded(p, corpus));
    return {
      id,
      sourceId: source.id,
      runId,
      statement: draft.statement,
      explanation: draft.explanation,
      evidenceHighlightIds,
      evidencePassages,
      importanceReason: draft.importanceReason,
      ideaType: draft.ideaType,
      epistemicStatus: draft.epistemicStatus,
      attribution: draft.attribution,
      centrality: draft.centrality,
      grounded,
      // In "from my highlights" runs, ideas the reader didn't highlight are offered but not pre-selected.
      status: grounded && draft.centrality !== "peripheral" && (scope !== "highlights" || evidenceHighlightIds.length > 0) ? "approved" : "candidate",
      createdAt: now + i,
    };
  });

  const interpretations: HighlightInterpretation[] = result.interpretations.map((h) => ({
    highlightId: h.highlightId,
    disposition: h.disposition,
    relation: h.relation,
    ideaIds: h.ideaKeys.map((k) => keyToId.get(k)).filter((x): x is string => !!x),
    note: h.note,
  }));

  const run: GenerationRun = {
    id: runId,
    sourceId: source.id,
    scope,
    studyMode: mode,
    model: provider.model,
    inputHash: hashString([source.contentHash, scope, mode, ...highlights.map((h) => h.id)].join("|")),
    thesis: result.thesis,
    summary: result.summary,
    highlightIds: highlights.map((h) => h.id),
    interpretations,
    ideaIds: ideas.map((i) => i.id),
    cardCandidateIds: [],
    stats: { highlights: highlights.length, ideas: ideas.length, cardsProposed: 0, cardsDroppedByReview: 0, cardsRevisedByReview: 0, duplicatesRemoved: 0 },
    createdAt: now,
  };

  await putIdeas(ideas);
  await putRun(run);
  if (scope !== "selection" && result.thesis) {
    await putSource({ ...source, thesis: result.thesis, summary: result.summary, updatedAt: Date.now() });
  }
  return { run, ideas };
}

export interface GenerationOutcome {
  run: GenerationRun;
  cards: CardCandidate[];
  skippedIdeas: { ideaId: string; reason: string }[];
}

function toCandidate(draft: DraftCard, source: Source, runId: string, now: number, flags: string[]): CardCandidate {
  return {
    id: newId("card"),
    sourceId: source.id,
    ideaId: draft.ideaId,
    runId,
    front: draft.front,
    back: draft.back,
    cardType: draft.cardType,
    sourceEvidence: draft.sourceExcerpt,
    confidence: draft.confidence,
    qualityFlags: flags,
    status: "suggested",
    originalFront: draft.front,
    originalBack: draft.back,
    editedByUser: false,
    editedAfterExport: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function generateCards(opts: {
  provider: AIProvider;
  source: Source;
  run: GenerationRun;
  ideas: Idea[];
  highlights: Highlight[];
  mode: StudyMode;
  onStage?: (stage: PipelineStage) => void;
  signal?: AbortSignal;
}): Promise<GenerationOutcome> {
  const { provider, source, highlights, mode, onStage, signal } = opts;
  const run = { ...opts.run, studyMode: mode };
  // Evidence requirement: ideas without locatable evidence never become cards.
  const ideas = opts.ideas.filter((i) => i.grounded);
  if (ideas.length === 0) return { run, cards: [], skippedIdeas: [] };

  const existing = (await cardsForSource(source.id)).filter((c) => c.status !== "rejected");
  const existingFronts = existing.map((c) => c.front);

  onStage?.("designing_prompts");
  const generated = await provider.generateCards({ source, ideas, highlights, scope: run.scope, mode, existingFronts, signal });
  let drafts = generated.cards.filter((c) => !isBlocking(qualityFlags(c)));
  const proposed = drafts.length;

  onStage?.("checking_quality");
  const ideaById = new Map(ideas.map((i) => [i.id, i]));
  const temp = drafts.map((d, i) => ({ ...d, id: `tmp${i}` }));
  let dropped = 0;
  let revised = 0;
  let reviewFailed = false;
  try {
    const review = await provider.reviewCards({
      source,
      cards: temp.map((c) => ({ id: c.id, front: c.front, back: c.back, cardType: c.cardType, idea: ideaById.get(c.ideaId)! })),
      highlights,
      existingFronts,
      signal,
    });
    const byId = new Map(review.reviews.map((r) => [r.cardId, r]));
    drafts = [];
    for (const c of temp) {
      const r = byId.get(c.id);
      if (r?.verdict === "drop") {
        dropped++;
        continue;
      }
      if (r?.verdict === "revise" && r.front && r.back) {
        revised++;
        drafts.push({ ...c, front: r.front, back: r.back });
      } else {
        drafts.push(c);
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    // Keep the unreviewed cards rather than losing the generation; they are labelled as such.
    reviewFailed = true;
  }

  // Order by importance so budget trimming and duplicate removal keep the best cards.
  drafts.sort((a, b) => {
    const ia = ideaById.get(a.ideaId)!;
    const ib = ideaById.get(b.ideaId)!;
    return CENTRALITY_RANK[ia.centrality] - CENTRALITY_RANK[ib.centrality] || CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  });
  const dupes = duplicateIndices(
    drafts.map((d) => d.front),
    existingFronts,
  );
  drafts = drafts.filter((_, i) => !dupes.has(i)).slice(0, cardBudget(run.scope, mode));

  const now = Date.now();
  const cards = drafts
    .map((d, i) => {
      const flags = qualityFlags(d);
      if (reviewFailed) flags.push("unreviewed");
      return toCandidate(d, source, run.id, now + i, flags);
    })
    .filter((c) => !isBlocking(c.qualityFlags));

  const updatedRun: GenerationRun = {
    ...run,
    cardCandidateIds: [...run.cardCandidateIds, ...cards.map((c) => c.id)],
    stats: { ...run.stats, cardsProposed: run.stats.cardsProposed + proposed, cardsDroppedByReview: run.stats.cardsDroppedByReview + dropped, cardsRevisedByReview: run.stats.cardsRevisedByReview + revised, duplicatesRemoved: run.stats.duplicatesRemoved + dupes.size },
  };
  await putCards(cards);
  await putRun(updatedRun);
  return { run: updatedRun, cards, skippedIdeas: generated.skippedIdeas };
}

export async function regenerateCard(opts: {
  provider: AIProvider;
  source: Source;
  card: CardCandidate;
  idea: Idea;
  highlights: Highlight[];
  siblingFronts: string[];
  direction: RegenerateDirection;
  signal?: AbortSignal;
}): Promise<CardCandidate> {
  const { provider, source, card, idea, highlights, siblingFronts, direction, signal } = opts;
  const draft = await provider.regenerateCard({ source, idea, card, siblingFronts, highlights, direction, signal });
  const updated: CardCandidate = {
    ...card,
    front: draft.front,
    back: draft.back,
    cardType: draft.cardType,
    sourceEvidence: draft.sourceExcerpt || card.sourceEvidence,
    qualityFlags: qualityFlags(draft),
    status: card.status === "rejected" ? "suggested" : card.status,
    originalFront: draft.front,
    originalBack: draft.back,
    editedByUser: false,
    updatedAt: Date.now(),
  };
  await putCard(updated);
  return updated;
}
