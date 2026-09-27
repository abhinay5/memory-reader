import type {
  CardType,
  Centrality,
  Confidence,
  EpistemicStatus,
  GenerationScope,
  Highlight,
  HighlightDisposition,
  HighlightRelation,
  Idea,
  IdeaType,
  Source,
  StudyMode,
} from "../types";
import { AIError, type StructuredLLM } from "./llm";
import {
  ANALYZE_SYSTEM,
  DIGEST_SYSTEM,
  GENERATE_SYSTEM,
  REGENERATE_DIRECTIONS,
  REGENERATE_SYSTEM,
  REVIEW_SYSTEM,
  SELECTION_CARD_BUDGET,
  SELECTION_IDEA_BUDGET,
  STUDY_MODE_GUIDANCE,
  type RegenerateDirection,
} from "./prompts";
import {
  chunkSectionsForDigest,
  DIGEST_LIMIT,
  renderFocusedArticle,
  withNeighbours,
  esc,
  FULL_TEXT_LIMIT,
  renderDigestRequest,
  renderExistingCards,
  renderFullArticle,
  renderHierarchicalArticle,
  renderHighlights,
  renderIdea,
  renderOutline,
  renderSourceMeta,
  sectionsContaining,
} from "./render";
import { AnalysisSchema, CardsSchema, DigestSchema, RegeneratedSchema, ReviewSchema, type REVIEW_PROBLEMS } from "./schemas";

// ---- Provider-neutral interface ----------------------------------------------------------

export interface AnalyzeInput {
  source: Source;
  highlights: Highlight[];
  scope: GenerationScope;
  mode: StudyMode;
  signal?: AbortSignal;
  onProgress?: (stage: "reading" | "finding_ideas") => void;
}

export interface DraftIdea {
  key: string;
  statement: string;
  explanation: string;
  importanceReason: string;
  ideaType: IdeaType;
  epistemicStatus: EpistemicStatus;
  attribution: string | null;
  centrality: Centrality;
  evidence: { highlightId: string | null; excerpt: string }[];
}

export interface AnalyzeResult {
  thesis: string;
  summary: string;
  ideas: DraftIdea[];
  interpretations: { highlightId: string; disposition: HighlightDisposition; relation: HighlightRelation; ideaKeys: string[]; note: string }[];
}

export interface GenerateInput {
  source: Source;
  ideas: Idea[];
  highlights: Highlight[];
  scope: GenerationScope;
  mode: StudyMode;
  existingFronts: string[];
  signal?: AbortSignal;
}

export interface DraftCard {
  ideaId: string;
  front: string;
  back: string;
  cardType: CardType;
  sourceExcerpt: string;
  confidence: Confidence;
}

export interface GenerateResult {
  cards: DraftCard[];
  skippedIdeas: { ideaId: string; reason: string }[];
}

export interface ReviewInput {
  source: Source;
  cards: { id: string; front: string; back: string; cardType: CardType; idea: Idea }[];
  highlights: Highlight[];
  existingFronts: string[];
  signal?: AbortSignal;
}

export type ReviewProblem = (typeof REVIEW_PROBLEMS)[number];

export interface ReviewResult {
  reviews: { cardId: string; verdict: "keep" | "revise" | "drop"; problems: ReviewProblem[]; reason: string; front: string | null; back: string | null }[];
}

export interface RegenerateInput {
  source: Source;
  idea: Idea;
  card: { front: string; back: string };
  siblingFronts: string[];
  highlights: Highlight[];
  direction: RegenerateDirection;
  signal?: AbortSignal;
}

export interface AIProvider {
  readonly model: string;
  analyzeSource(input: AnalyzeInput): Promise<AnalyzeResult>;
  generateCards(input: GenerateInput): Promise<GenerateResult>;
  reviewCards(input: ReviewInput): Promise<ReviewResult>;
  regenerateCard(input: RegenerateInput): Promise<DraftCard>;
}

// ---- Claude implementation ---------------------------------------------------------------

export function cardBudget(scope: GenerationScope, mode: StudyMode): number {
  return scope === "selection" ? SELECTION_CARD_BUDGET : STUDY_MODE_GUIDANCE[mode].cardBudget;
}

export function ideaBudget(scope: GenerationScope, mode: StudyMode): number {
  if (scope === "selection") return SELECTION_IDEA_BUDGET;
  if (scope === "article") return 15;
  return STUDY_MODE_GUIDANCE[mode].ideaBudget;
}

function aliasMap(ids: string[], prefix: string): { forward: Map<string, string>; back: Map<string, string> } {
  const forward = new Map<string, string>();
  const back = new Map<string, string>();
  ids.forEach((id, i) => {
    forward.set(id, `${prefix}${i + 1}`);
    back.set(`${prefix}${i + 1}`, id);
  });
  return { forward, back };
}

function scopeTask(scope: GenerationScope, mode: StudyMode, highlightCount: number): string {
  const budget = ideaBudget(scope, mode);
  switch (scope) {
    case "article":
      return `<task>
Analyse the whole article. Produce its thesis, a short summary, and between roughly 5 and ${budget} candidate ideas worth retaining, depending on how substantial the material is (fewer for thin material). ${highlightCount ? "The reader's highlights are included; mark them in highlight_interpretations." : "There are no highlights; highlight_interpretations must be an empty list."}
</task>`;
    case "highlights":
      return `<task>
The reader highlighted ${highlightCount} passage(s) while reading. Recover each highlight's meaning from its context and the article, group highlights that point to the same underlying idea, and infer the ideas the reader appears to be trying to understand. Do not make one idea per highlight by default. Every idea must be pointed to by at least one highlight (cite it in evidence); use the rest of the article only as context for interpreting them, not as a source of extra ideas. Return at most ${budget} ideas (usually fewer than the number of highlights), and a highlight_interpretations entry for every highlight.
${STUDY_MODE_GUIDANCE[mode].guidance}
</task>`;
    case "selection":
      return `<task>
The reader selected one passage and asked to remember it. Using its surrounding context and what is known about the source, identify the 1–${budget} idea(s) in or behind this passage that are worth retaining. If the passage cannot be understood reliably from the context given, return no ideas and mark it "insufficient_context". Include one highlight_interpretations entry for the passage.
</task>`;
  }
}

export class ClaudeProvider implements AIProvider {
  constructor(private readonly llm: StructuredLLM) {}

  get model(): string {
    return this.llm.model;
  }

  private async articleRepresentation(input: AnalyzeInput): Promise<string> {
    const { source, highlights, scope, signal } = input;
    if (scope === "selection") {
      const known = [source.thesis ? `<known_thesis>${esc(source.thesis)}</known_thesis>` : "", source.summary ? `<known_summary>${esc(source.summary)}</known_summary>` : ""];
      return [renderOutline(source), ...known].filter(Boolean).join("\n\n");
    }
    if (!source.extractedText.trim() || source.sourceType === "pasted_highlights") return "";
    if (source.extractedText.length <= FULL_TEXT_LIMIT) return renderFullArticle(source);

    // Very long sources (e.g. a whole book). With highlights, send only the sections around them —
    // fast and cheap. Without highlights, condense section by section, up to a hard size limit.
    const focus = sectionsContaining(source.outline, highlights);
    if (focus.size > 0) return renderFocusedArticle(source, withNeighbours(focus, source.outline.length));
    if (source.extractedText.length > DIGEST_LIMIT) {
      throw new AIError("other", "This source is too long to analyze as a whole. Highlight the passages you care about and use “Generate from highlights” instead.");
    }
    const chunks = chunkSectionsForDigest(source.outline, focus);
    const digests = new Map<number, string>();
    const queue = [...chunks];
    const worker = async () => {
      for (let chunk = queue.shift(); chunk; chunk = queue.shift()) {
        const out = await this.llm.complete({ name: "digest", system: DIGEST_SYSTEM, user: renderDigestRequest(source, chunk), schema: DigestSchema, maxTokens: 16000, effort: "low", signal });
        for (const s of out.sections) digests.set(s.index, s.digest);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return renderHierarchicalArticle(source, digests, focus);
  }

  async analyzeSource(input: AnalyzeInput): Promise<AnalyzeResult> {
    const { source, highlights, scope, mode, signal } = input;
    input.onProgress?.("reading");
    const article = await this.articleRepresentation(input);
    input.onProgress?.("finding_ideas");
    const hAlias = aliasMap(
      highlights.map((h) => h.id),
      "h",
    );
    const user = [
      renderSourceMeta(source),
      article,
      renderHighlights(highlights, hAlias.forward, true),
      scopeTask(scope, mode, highlights.length),
    ]
      .filter(Boolean)
      .join("\n\n");

    const out = await this.llm.complete({ name: "analysis", system: ANALYZE_SYSTEM, user, schema: AnalysisSchema, effort: "medium", signal });
    const ideaKeys = new Set(out.ideas.map((i) => i.key));
    return {
      thesis: out.thesis,
      summary: out.summary,
      ideas: out.ideas.map((i) => ({
        key: i.key,
        statement: i.statement,
        explanation: i.explanation,
        importanceReason: i.importance_reason,
        ideaType: i.idea_type,
        epistemicStatus: i.epistemic_status,
        attribution: i.attribution,
        centrality: i.centrality,
        evidence: i.evidence.map((e) => ({ highlightId: (e.highlight_id && hAlias.back.get(e.highlight_id)) || null, excerpt: e.excerpt })),
      })),
      interpretations: out.highlight_interpretations
        .filter((h) => hAlias.back.has(h.highlight_id))
        .map((h) => ({
          highlightId: hAlias.back.get(h.highlight_id)!,
          disposition: h.disposition,
          relation: h.relation,
          ideaKeys: h.idea_keys.filter((k) => ideaKeys.has(k)),
          note: h.note,
        })),
    };
  }

  async generateCards(input: GenerateInput): Promise<GenerateResult> {
    const { source, ideas, highlights, scope, mode, existingFronts, signal } = input;
    const iAlias = aliasMap(
      ideas.map((i) => i.id),
      "i",
    );
    const byId = new Map(highlights.map((h) => [h.id, h]));
    const budget = cardBudget(scope, mode);
    const user = [
      renderSourceMeta(source),
      source.thesis ? `<source_thesis>${esc(source.thesis)}</source_thesis>` : "",
      `<ideas>\n${ideas.map((i) => renderIdea(i, iAlias.forward.get(i.id)!, byId)).join("\n\n")}\n</ideas>`,
      renderExistingCards(existingFronts),
      `<task>
Design retrieval prompts for the ideas above. Card budget: at most ${budget} cards in total — a ceiling, not a target. ${scope === "selection" ? "This is a single passage: 1–3 cards, and one is often right." : STUDY_MODE_GUIDANCE[mode].guidance}
Give more cards to central ideas; an idea may get zero cards if it doesn't justify review. Reference each card's idea by its key.
</task>`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const out = await this.llm.complete({ name: "cards", system: GENERATE_SYSTEM, user, schema: CardsSchema, effort: "medium", signal });
    return {
      cards: out.cards
        .filter((c) => iAlias.back.has(c.idea_key))
        .map((c) => ({
          ideaId: iAlias.back.get(c.idea_key)!,
          front: c.front.trim(),
          back: c.back.trim(),
          cardType: c.card_type,
          sourceExcerpt: c.source_excerpt.trim(),
          confidence: c.confidence,
        })),
      skippedIdeas: out.ideas_without_cards.filter((s) => iAlias.back.has(s.idea_key)).map((s) => ({ ideaId: iAlias.back.get(s.idea_key)!, reason: s.reason })),
    };
  }

  async reviewCards(input: ReviewInput): Promise<ReviewResult> {
    const { source, cards, highlights, existingFronts, signal } = input;
    if (cards.length === 0) return { reviews: [] };
    const cAlias = aliasMap(
      cards.map((c) => c.id),
      "c",
    );
    const ideas = [...new Map(cards.map((c) => [c.idea.id, c.idea])).values()];
    const iAlias = aliasMap(
      ideas.map((i) => i.id),
      "i",
    );
    const byId = new Map(highlights.map((h) => [h.id, h]));
    const user = [
      renderSourceMeta(source),
      `<ideas>\n${ideas.map((i) => renderIdea(i, iAlias.forward.get(i.id)!, byId)).join("\n\n")}\n</ideas>`,
      renderExistingCards(existingFronts),
      `<cards>\n${cards
        .map((c) => `<card id="${cAlias.forward.get(c.id)}" idea="${iAlias.forward.get(c.idea.id)}" type="${c.cardType}">\n<front>${esc(c.front)}</front>\n<back>${esc(c.back)}</back>\n</card>`)
        .join("\n\n")}\n</cards>`,
      `<task>Review every card above and return exactly one review per card id.</task>`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const out = await this.llm.complete({ name: "review", system: REVIEW_SYSTEM, user, schema: ReviewSchema, effort: "low", signal });
    return {
      reviews: out.reviews
        .filter((r) => cAlias.back.has(r.card_id))
        .map((r) => ({
          cardId: cAlias.back.get(r.card_id)!,
          verdict: r.verdict,
          problems: r.problems,
          reason: r.reason,
          front: r.revised_front?.trim() || null,
          back: r.revised_back?.trim() || null,
        })),
    };
  }

  async regenerateCard(input: RegenerateInput): Promise<DraftCard> {
    const { source, idea, card, siblingFronts, highlights, direction, signal } = input;
    const byId = new Map(highlights.map((h) => [h.id, h]));
    const user = [
      renderSourceMeta(source),
      renderIdea(idea, "i1", byId),
      `<current_card>\n<front>${esc(card.front)}</front>\n<back>${esc(card.back)}</back>\n</current_card>`,
      renderExistingCards(siblingFronts),
      `<task>${REGENERATE_DIRECTIONS[direction]}</task>`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const out = await this.llm.complete({ name: "card", system: REGENERATE_SYSTEM, user, schema: RegeneratedSchema, maxTokens: 16000, effort: "low", signal });
    return { ideaId: idea.id, front: out.front.trim(), back: out.back.trim(), cardType: out.card_type, sourceExcerpt: out.source_excerpt.trim(), confidence: "medium" };
  }
}
