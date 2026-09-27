import { beforeEach, describe, expect, it } from "vitest";
import type { StructuredLLM, StructuredRequest } from "../src/ai/llm";
import { analyzeSource, generateCards, regenerateCard } from "../src/ai/pipeline";
import { ClaudeProvider } from "../src/ai/provider";
import type { AnalysisOutput, CardsOutput, RegeneratedOutput, ReviewOutput } from "../src/ai/schemas";
import { cardsForSource, clearAllData, getRun, putHighlight, putSource } from "../src/storage/db";
import type { Highlight, Source } from "../src/types";

const TEXT = `One day in the mid-1980s a reporter arrived at the office of Alexander Luria.

This essay describes a spaced-repetition system that makes memory a choice rather than a haphazard event left to chance.

## The role of memory in creative work

Internalized knowledge greatly increases the number of associations available during thought. You cannot connect ideas you do not know.

Isolated questions tend to become orphans: difficult to remember and of little use, because they lack connections to anything else.`;

const source: Source = {
  id: "src_test",
  url: "https://example.com/memory",
  canonicalUrl: null,
  title: "Augmenting Long-term Memory",
  author: "Michael Nielsen",
  site: "Example Essays",
  sourceType: "web_article",
  extractedText: TEXT,
  outline: [
    { heading: null, level: 0, paragraphs: TEXT.split("\n\n").slice(0, 2) },
    { heading: "The role of memory in creative work", level: 2, paragraphs: TEXT.split("\n\n").slice(3) },
  ],
  wordCount: 90,
  contentHash: "abc",
  thesis: null,
  summary: null,
  createdAt: 1,
  updatedAt: 1,
};

function hl(id: string, text: string): Highlight {
  return { id, sourceId: source.id, exactText: text, prefix: "", suffix: "", sectionHeading: "The role of memory in creative work", paragraph: text, contextBefore: "", contextAfter: "", anchorData: { start: 0, end: 1 }, anchorStatus: "anchored", userNote: null, createdAt: 1 };
}

const highlights = [
  hl("hl_a", "Internalized knowledge greatly increases the number of associations available during thought."),
  hl("hl_b", "You cannot connect ideas you do not know."),
  hl("hl_c", "One day in the mid-1980s a reporter arrived at the office of Alexander Luria."),
];

const analysis: AnalysisOutput = {
  thesis: "Nielsen argues that spaced repetition can make memory a deliberate tool for creative and intellectual work.",
  summary: "The essay describes a memory system and argues that internalized knowledge supports creative association.",
  ideas: [
    {
      key: "i1",
      statement: "Nielsen argues that internalized knowledge increases the associations available during thought, which supports creativity.",
      explanation: "Creative connection requires knowing the things being connected.",
      importance_reason: "central to the thesis",
      idea_type: "claim",
      epistemic_status: "author_claim",
      attribution: "Michael Nielsen",
      centrality: "central",
      evidence: [
        { highlight_id: "h1", excerpt: "Internalized knowledge greatly increases the number of associations available during thought." },
        { highlight_id: "h2", excerpt: "You cannot connect ideas you do not know." },
      ],
    },
    {
      key: "i2",
      statement: "Isolated 'orphan' questions are hard to remember and of little use because they lack connections.",
      explanation: "Connected knowledge is easier to retain and use.",
      importance_reason: "explains a failure mode",
      idea_type: "mechanism",
      epistemic_status: "author_claim",
      attribution: "Michael Nielsen",
      centrality: "supporting",
      evidence: [{ highlight_id: null, excerpt: "Isolated questions tend to become orphans: difficult to remember and of little use" }],
    },
    {
      key: "i3",
      statement: "Memory palaces were invented by Simonides.",
      explanation: "Invented and unsupported.",
      importance_reason: "none",
      idea_type: "claim",
      epistemic_status: "historical_claim",
      attribution: null,
      centrality: "supporting",
      evidence: [{ highlight_id: null, excerpt: "Simonides of Ceos invented the method of loci after a banquet hall collapsed." }],
    },
  ],
  highlight_interpretations: [
    { highlight_id: "h1", disposition: "became_idea", relation: "core", idea_keys: ["i1"], note: "" },
    { highlight_id: "h2", disposition: "merged", relation: "supporting_evidence", idea_keys: ["i1"], note: "Same idea as h1." },
    { highlight_id: "h3", disposition: "not_worth_retaining", relation: "context_only", idea_keys: [], note: "Decorative anecdote." },
    { highlight_id: "h99", disposition: "merged", relation: "duplicate", idea_keys: ["i9"], note: "unknown id should be ignored" },
  ],
};

const cards: CardsOutput = {
  cards: [
    { idea_key: "i1", front: "According to Nielsen, why does internalized knowledge support creative thinking?", back: "It increases the associations available during thought; you can't connect ideas you don't know.", card_type: "source_claim", source_excerpt: "Internalized knowledge greatly increases the number of associations available during thought.", confidence: "high" },
    { idea_key: "i1", front: "According to Nielsen, why does internalized knowledge support creative thought?", back: "Near-duplicate.", card_type: "source_claim", source_excerpt: "", confidence: "medium" },
    { idea_key: "i2", front: "What is an orphan question?", back: "A question lacking connections.", card_type: "definition", source_excerpt: "", confidence: "medium" },
    { idea_key: "i1", front: "What do memory systems make memory?", back: "A choice.", card_type: "definition", source_excerpt: "", confidence: "low" },
    { idea_key: "i7", front: "Unknown idea key", back: "Ignored.", card_type: "definition", source_excerpt: "", confidence: "low" },
  ],
  ideas_without_cards: [],
};

const review: ReviewOutput = {
  reviews: [
    { card_id: "c1", verdict: "keep", problems: [], reason: "", revised_front: null, revised_back: null },
    { card_id: "c2", verdict: "keep", problems: [], reason: "", revised_front: null, revised_back: null },
    {
      card_id: "c3",
      verdict: "revise",
      problems: ["context_dependent"],
      reason: "Needs attribution and precision.",
      revised_front: "Why does Michael Nielsen consider isolated 'orphan' questions poor spaced-repetition items?",
      revised_back: "They lack connections to other knowledge, so they are hard to remember and of little use.",
    },
    { card_id: "c4", verdict: "drop", problems: ["tests_wording"], reason: "Sentence transformation.", revised_front: null, revised_back: null },
  ],
};

class FakeLLM implements StructuredLLM {
  model = "fake-model";
  requests: StructuredRequest<unknown>[] = [];
  constructor(private readonly responses: Record<string, unknown>) {}
  async complete<T>(request: StructuredRequest<T>): Promise<T> {
    this.requests.push(request as StructuredRequest<unknown>);
    const res = this.responses[request.name];
    if (res instanceof Error) throw res;
    // Mirror the real client: every response is validated against the schema.
    return request.schema.parse(res);
  }
}

beforeEach(async () => {
  await clearAllData();
  await putSource(source);
  for (const h of highlights) await putHighlight(h);
});

describe("analysis stage", () => {
  it("sends highlights with context under aliases and maps results back to real ids", async () => {
    const llm = new FakeLLM({ analysis });
    const { run, ideas } = await analyzeSource({ provider: new ClaudeProvider(llm), source, highlights, scope: "highlights", mode: "understand" });
    const prompt = llm.requests[0].user;
    expect(prompt).toContain('<highlight id="h1" section="The role of memory in creative work">');
    expect(prompt).toContain("<article>");
    expect(prompt).not.toContain("hl_a");

    expect(ideas).toHaveLength(3);
    expect(ideas[0].evidenceHighlightIds).toEqual(["hl_a", "hl_b"]);
    expect(ideas[0].grounded).toBe(true);
    expect(ideas[1].grounded).toBe(true); // excerpt found in source text
    expect(ideas[1].status).toBe("candidate"); // not highlighted → offered, not pre-selected
    expect(ideas[2].grounded).toBe(false); // invented evidence
    expect(ideas[2].status).toBe("candidate");

    expect(run.interpretations.map((i) => i.highlightId)).toEqual(["hl_a", "hl_b", "hl_c"]);
    expect(run.interpretations[1]).toMatchObject({ disposition: "merged", ideaIds: [ideas[0].id] });
    expect((await getRun(run.id))!.thesis).toMatch(/^Nielsen argues/);
  });
});

describe("card stage", () => {
  it("generates, reviews, dedupes and persists cards only for grounded ideas", async () => {
    const llm = new FakeLLM({ analysis, cards, review });
    const provider = new ClaudeProvider(llm);
    const { run, ideas } = await analyzeSource({ provider, source, highlights, scope: "highlights", mode: "understand" });
    const out = await generateCards({ provider, source, run, ideas, highlights, mode: "understand" });

    const genPrompt = llm.requests[1].user;
    expect(genPrompt).toContain("Card budget: at most 12 cards");
    expect(genPrompt).not.toContain("Simonides"); // ungrounded idea never reaches card generation

    const fronts = out.cards.map((c) => c.front);
    expect(fronts).toEqual([
      "According to Nielsen, why does internalized knowledge support creative thinking?",
      "Why does Michael Nielsen consider isolated 'orphan' questions poor spaced-repetition items?",
    ]);
    // (generateCards receives whatever ideas the caller passes; the UI passes only approved ones.)
    expect(out.cards.every((c) => c.status === "suggested" && ideas.some((i) => i.id === c.ideaId))).toBe(true);
    expect(out.run.stats).toMatchObject({ cardsDroppedByReview: 1, cardsRevisedByReview: 1, duplicatesRemoved: 1 });
    expect((await cardsForSource(source.id)).map((c) => c.id).sort()).toEqual(out.cards.map((c) => c.id).sort());
  });

  it("keeps cards (labelled) when the review step fails, rather than losing work", async () => {
    const llm = new FakeLLM({ analysis, cards, review: new Error("review failed") });
    const provider = new ClaudeProvider(llm);
    const { run, ideas } = await analyzeSource({ provider, source, highlights, scope: "highlights", mode: "understand" });
    const out = await generateCards({ provider, source, run, ideas, highlights, mode: "understand" });
    expect(out.cards.length).toBeGreaterThan(0);
    expect(out.cards.every((c) => c.qualityFlags.includes("unreviewed"))).toBe(true);
  });

  it("respects the selection budget of three cards", async () => {
    const many: CardsOutput = { cards: Array.from({ length: 6 }, (_, i) => ({ ...cards.cards[0], front: `Distinct question number ${i} about topic ${"xyz".repeat(i + 1)}?` })), ideas_without_cards: [] };
    const llm = new FakeLLM({ analysis, cards: many, review: { reviews: [] } });
    const provider = new ClaudeProvider(llm);
    const { run, ideas } = await analyzeSource({ provider, source, highlights: [highlights[0]], scope: "selection", mode: "master" });
    const out = await generateCards({ provider, source, run, ideas, highlights: [highlights[0]], mode: "master" });
    expect(out.cards.length).toBe(3);
  });

  it("does not duplicate cards that already exist for the source", async () => {
    const llm = new FakeLLM({ analysis, cards, review });
    const provider = new ClaudeProvider(llm);
    const a = await analyzeSource({ provider, source, highlights, scope: "highlights", mode: "understand" });
    await generateCards({ provider, source, run: a.run, ideas: a.ideas, highlights, mode: "understand" });
    const b = await analyzeSource({ provider, source, highlights, scope: "highlights", mode: "understand" });
    const second = await generateCards({ provider, source, run: b.run, ideas: b.ideas, highlights, mode: "understand" });
    expect(llm.requests[llm.requests.length - 2].user).toContain("<existing_cards");
    expect(second.cards.map((c) => c.front)).not.toContain("According to Nielsen, why does internalized knowledge support creative thinking?");
  });
});

describe("regeneration", () => {
  it("replaces one card's formulation while keeping its idea", async () => {
    const regenerated: RegeneratedOutput = { front: "How does Nielsen connect memory to creative association?", back: "Knowing more gives thought more associations to draw on.", card_type: "relationship", source_excerpt: "" };
    const llm = new FakeLLM({ analysis, cards, review, card: regenerated });
    const provider = new ClaudeProvider(llm);
    const { run, ideas } = await analyzeSource({ provider, source, highlights, scope: "highlights", mode: "understand" });
    const { cards: made } = await generateCards({ provider, source, run, ideas, highlights, mode: "understand" });
    const updated = await regenerateCard({ provider, source, card: made[0], idea: ideas[0], highlights, siblingFronts: [], direction: "different_angle" });
    expect(updated.id).toBe(made[0].id);
    expect(updated.ideaId).toBe(made[0].ideaId);
    expect(updated.front).toBe(regenerated.front);
    expect(updated.sourceEvidence).toBe(made[0].sourceEvidence);
    expect(llm.requests.at(-1)!.user).toContain("genuinely different retrieval route");
  });
});

describe("very long sources", () => {
  const long: Source = {
    ...source,
    id: "src_long",
    outline: Array.from({ length: 40 }, (_, i) => ({ heading: `Chapter ${i + 1}`, level: 2, paragraphs: [`Chapter ${i + 1} text. ` + "Lorem ipsum dolor sit amet. ".repeat(900)] })),
  };
  long.extractedText = long.outline.map((s) => s.paragraphs.join(" ")).join("\n\n");

  it("sends only the sections around highlights, without digest calls", async () => {
    const h = { ...hl("hl_long", "Chapter 20 text."), sourceId: long.id };
    const llm = new FakeLLM({ analysis: { ...analysis, ideas: [], highlight_interpretations: [] } });
    await analyzeSource({ provider: new ClaudeProvider(llm), source: long, highlights: [h], scope: "highlights", mode: "understand" });
    expect(llm.requests.map((r) => r.name)).toEqual(["analysis"]);
    const prompt = llm.requests[0].user;
    expect(prompt).toContain('<section index="19" heading="Chapter 20">');
    expect(prompt).toContain('<section index="18"');
    expect(prompt).not.toContain('<section index="5"');
    expect(prompt.length).toBeLessThan(long.extractedText.length / 5);
  });

  it("refuses whole-book analysis without highlights instead of running up cost", async () => {
    const huge = { ...long, extractedText: long.extractedText.repeat(2) };
    const llm = new FakeLLM({});
    await expect(analyzeSource({ provider: new ClaudeProvider(llm), source: huge, highlights: [], scope: "article", mode: "understand" })).rejects.toThrow(/too long/);
    expect(llm.requests).toHaveLength(0);
  });
});
