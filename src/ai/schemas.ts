import { z } from "zod";
import { EPISTEMIC_STATUSES, HIGHLIGHT_DISPOSITIONS, HIGHLIGHT_RELATIONS, IDEA_TYPES } from "../types";

// The reader doesn't want cloze cards, so the model can't produce them.
export const GENERATED_CARD_TYPES = ["definition", "explanation", "causal", "mechanism", "contrast", "relationship", "source_claim", "application"] as const;

// Runtime schemas for every model response. They double as the JSON schema sent to the API
// (structured outputs), and every response is validated again locally before use.

export const AnalysisSchema = z.object({
  thesis: z.string(),
  summary: z.string(),
  ideas: z.array(
    z.object({
      key: z.string(),
      statement: z.string(),
      explanation: z.string(),
      importance_reason: z.string(),
      idea_type: z.enum(IDEA_TYPES),
      epistemic_status: z.enum(EPISTEMIC_STATUSES),
      attribution: z.string().nullable(),
      centrality: z.enum(["central", "supporting", "peripheral"]),
      evidence: z.array(z.object({ highlight_id: z.string().nullable(), excerpt: z.string() })),
    }),
  ),
  highlight_interpretations: z.array(
    z.object({
      highlight_id: z.string(),
      disposition: z.enum(HIGHLIGHT_DISPOSITIONS),
      relation: z.enum(HIGHLIGHT_RELATIONS),
      idea_keys: z.array(z.string()),
      note: z.string(),
    }),
  ),
});
export type AnalysisOutput = z.infer<typeof AnalysisSchema>;

export const CardsSchema = z.object({
  cards: z.array(
    z.object({
      idea_key: z.string(),
      front: z.string(),
      back: z.string(),
      card_type: z.enum(GENERATED_CARD_TYPES),
      source_excerpt: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  ideas_without_cards: z.array(z.object({ idea_key: z.string(), reason: z.string() })),
});
export type CardsOutput = z.infer<typeof CardsSchema>;

export const REVIEW_PROBLEMS = [
  "ungrounded",
  "not_important",
  "not_atomic",
  "ambiguous",
  "context_dependent",
  "answer_in_prompt",
  "tests_wording",
  "attribution",
  "duplicate",
  "answer_too_long",
] as const;

export const ReviewSchema = z.object({
  reviews: z.array(
    z.object({
      card_id: z.string(),
      verdict: z.enum(["keep", "revise", "drop"]),
      problems: z.array(z.enum(REVIEW_PROBLEMS)),
      reason: z.string(),
      revised_front: z.string().nullable(),
      revised_back: z.string().nullable(),
    }),
  ),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

export const RegeneratedSchema = z.object({
  front: z.string(),
  back: z.string(),
  card_type: z.enum(GENERATED_CARD_TYPES),
  source_excerpt: z.string(),
});
export type RegeneratedOutput = z.infer<typeof RegeneratedSchema>;

export const DigestSchema = z.object({
  sections: z.array(z.object({ index: z.number().int(), digest: z.string() })),
});
export type DigestOutput = z.infer<typeof DigestSchema>;
