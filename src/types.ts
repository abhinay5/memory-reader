// Domain model. The hierarchy is Source → Highlights → Ideas → Cards (never Highlight → Card):
// an Idea is the stable unit of understanding; cards are replaceable retrieval routes to it.

export type SourceType = "web_article" | "pasted_text" | "pasted_highlights";

export interface OutlineSection {
  heading: string | null;
  level: number;
  paragraphs: string[];
}

export interface Source {
  id: string;
  url: string | null;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  site: string | null;
  sourceType: SourceType;
  extractedText: string;
  outline: OutlineSection[];
  wordCount: number;
  contentHash: string;
  /** Latest article-level understanding, kept so selection prompts can use it. */
  thesis: string | null;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TextAnchor {
  /** Offsets into the whitespace-normalised page text at creation time; a tie-break hint only. */
  start: number;
  end: number;
}

export type AnchorStatus = "anchored" | "unavailable" | "unknown";

export interface Highlight {
  id: string;
  sourceId: string;
  exactText: string;
  prefix: string;
  suffix: string;
  sectionHeading: string | null;
  paragraph: string;
  contextBefore: string;
  contextAfter: string;
  anchorData: TextAnchor | null;
  anchorStatus: AnchorStatus;
  userNote: string | null;
  createdAt: number;
}

export const IDEA_TYPES = [
  "concept",
  "claim",
  "mechanism",
  "causal_relationship",
  "distinction",
  "argument",
  "implication",
  "method",
  "definition",
  "source_specific_claim",
] as const;
export type IdeaType = (typeof IDEA_TYPES)[number];

export const EPISTEMIC_STATUSES = [
  "established_fact",
  "author_claim",
  "argument",
  "interpretation",
  "speculation",
  "reported_claim",
  "quotation",
  "historical_claim",
  "definition",
] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export type Centrality = "central" | "supporting" | "peripheral";
export type IdeaStatus = "candidate" | "approved" | "rejected";

export interface Idea {
  id: string;
  sourceId: string;
  runId: string;
  statement: string;
  explanation: string;
  evidenceHighlightIds: string[];
  evidencePassages: string[];
  importanceReason: string;
  ideaType: IdeaType;
  epistemicStatus: EpistemicStatus;
  attribution: string | null;
  centrality: Centrality;
  /** False when none of the evidence could be located in the source. Such ideas never get cards. */
  grounded: boolean;
  status: IdeaStatus;
  createdAt: number;
}

export const CARD_TYPES = [
  "definition",
  "explanation",
  "causal",
  "mechanism",
  "contrast",
  "relationship",
  "source_claim",
  "application",
  "cloze",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export type CardStatus = "suggested" | "approved" | "rejected" | "exported" | "failed";
export type Confidence = "high" | "medium" | "low";

export interface CardCandidate {
  id: string;
  sourceId: string;
  ideaId: string;
  runId: string;
  front: string;
  back: string;
  cardType: CardType;
  sourceEvidence: string;
  confidence: Confidence;
  qualityFlags: string[];
  status: CardStatus;
  /** The AI's final text before any user edit — kept locally as an evaluation signal. */
  originalFront: string;
  originalBack: string;
  editedByUser: boolean;
  /** Set when the card was edited after it was sent to Mochi. */
  editedAfterExport: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MochiSync {
  id: string;
  cardCandidateId: string;
  mochiCardId: string | null;
  mochiDeckId: string;
  deckName: string;
  syncStatus: "synced" | "failed";
  syncedAt: number;
  error: string | null;
}

export type StudyMode = "remember" | "understand" | "master";
export type GenerationScope = "article" | "highlights" | "selection";

export const HIGHLIGHT_DISPOSITIONS = [
  "became_idea",
  "merged",
  "supporting_context",
  "not_worth_retaining",
  "insufficient_context",
] as const;
export type HighlightDisposition = (typeof HIGHLIGHT_DISPOSITIONS)[number];

export const HIGHLIGHT_RELATIONS = [
  "core",
  "duplicate",
  "supporting_evidence",
  "example_of",
  "cause_of",
  "consequence_of",
  "contrast_with",
  "definition_of",
  "qualification_of",
  "objection_to",
  "extension_of",
  "context_only",
] as const;
export type HighlightRelation = (typeof HIGHLIGHT_RELATIONS)[number];

export interface HighlightInterpretation {
  highlightId: string;
  disposition: HighlightDisposition;
  relation: HighlightRelation;
  ideaIds: string[];
  note: string;
}

export interface RunStats {
  highlights: number;
  ideas: number;
  cardsProposed: number;
  cardsDroppedByReview: number;
  cardsRevisedByReview: number;
  duplicatesRemoved: number;
}

export interface GenerationRun {
  id: string;
  sourceId: string;
  scope: GenerationScope;
  studyMode: StudyMode;
  model: string;
  inputHash: string;
  thesis: string | null;
  summary: string | null;
  highlightIds: string[];
  interpretations: HighlightInterpretation[];
  ideaIds: string[];
  cardCandidateIds: string[];
  stats: RunStats;
  createdAt: number;
}

export interface MochiDeck {
  id: string;
  name: string;
}

export interface Settings {
  anthropicApiKey: string;
  model: string;
  mochiApiKey: string;
  defaultDeckId: string | null;
  defaultDeckName: string | null;
  studyMode: StudyMode;
  autoSourceTags: boolean;
  includeSourceLink: boolean;
  autoRestoreHighlights: boolean;
}

/** Article as extracted by the content script. */
export interface ExtractedArticle {
  url: string;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  site: string | null;
  sections: OutlineSection[];
  text: string;
  wordCount: number;
  contentHash: string;
  readerable: boolean;
  method: "readability" | "fallback";
}

/** What the content script captures for a new highlight. */
export interface CapturedHighlight {
  exactText: string;
  prefix: string;
  suffix: string;
  anchor: TextAnchor;
  sectionHeading: string | null;
  paragraph: string;
  contextBefore: string;
  contextAfter: string;
}
