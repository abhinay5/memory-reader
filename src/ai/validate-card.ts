import { contentWords, countWords, jaccard } from "../utils/text";

// Deterministic checks that complement the model's own review. They catch mechanical
// failures cheaply and label cards so the reader can see why one might need attention.

export const FLAG_LABELS: Record<string, string> = {
  empty: "Empty side",
  compound_question: "Asks more than one question",
  context_dependent: "May not make sense without the article",
  long_answer: "Long answer",
  answer_in_prompt: "Answer may be visible in the prompt",
  enumeration: "List-style answer",
  duplicate: "Similar to another card",
  unreviewed: "Not quality-checked (review step failed)",
};

const VAGUE_REFERENCE = /\b(the|this|that)\s+(article|essay|author|writer|passage|text|piece|post|excerpt|chapter|book|paper|reading)\b/i;
const PRONOUN_OPENING = /^(?:(?:why|how|what|when|where|who|in what way)\s+(?:does|did|is|was|do|are|were|would|can|could|might)\s+)?(?:he|she|they|it|this|that|these|those|him|her|them)\b/i;

export function qualityFlags(card: { front: string; back: string; cardType: string }): string[] {
  const flags: string[] = [];
  const front = card.front.trim();
  const back = card.back.trim();
  if (!front || !back) return ["empty"];
  if ((front.match(/\?/g) ?? []).length > 1) flags.push("compound_question");
  if (VAGUE_REFERENCE.test(front) || PRONOUN_OPENING.test(front)) flags.push("context_dependent");
  if (countWords(back) > 70) flags.push("long_answer");
  if (back.split("\n").filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length >= 4) flags.push("enumeration");
  if (card.cardType !== "cloze") {
    const backWords = [...new Set(contentWords(back))];
    const frontWords = new Set(contentWords(front));
    if (backWords.length >= 1 && backWords.length <= 6) {
      const shown = backWords.filter((w) => frontWords.has(w)).length;
      if (shown / backWords.length >= 0.8) flags.push("answer_in_prompt");
    }
  }
  return flags;
}

export function isBlocking(flags: string[]): boolean {
  return flags.includes("empty");
}

export const DUPLICATE_THRESHOLD = 0.7;

export function similarity(a: string, b: string): number {
  return jaccard(contentWords(a), contentWords(b));
}

/**
 * Indices of cards that substantially duplicate an earlier card in the list or an existing card.
 * Earlier cards win, so callers should order by preference.
 */
export function duplicateIndices(fronts: string[], existingFronts: string[], threshold = DUPLICATE_THRESHOLD): Set<number> {
  const dupes = new Set<number>();
  const kept: string[] = [...existingFronts];
  fronts.forEach((front, i) => {
    if (kept.some((k) => similarity(front, k) >= threshold)) dupes.add(i);
    else kept.push(front);
  });
  return dupes;
}
