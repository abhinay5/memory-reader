import { describe, expect, it } from "vitest";
import { duplicateIndices, qualityFlags } from "../src/ai/validate-card";
import { isExcerptGrounded } from "../src/utils/text";
import { parsePastedHighlights } from "../src/core/paste";

describe("deterministic card checks", () => {
  it("accepts a well-formed card", () => {
    expect(qualityFlags({ front: "According to Nielsen, why do isolated 'orphan' questions make poor spaced-repetition items?", back: "They lack connections to other knowledge, so they are hard to recall and rarely useful.", cardType: "source_claim" })).toEqual([]);
  });
  it("flags context-dependent and compound prompts", () => {
    expect(qualityFlags({ front: "Why does he reject it?", back: "Because it is flawed.", cardType: "explanation" })).toContain("context_dependent");
    expect(qualityFlags({ front: "What does the author argue about memory?", back: "Memory matters.", cardType: "explanation" })).toContain("context_dependent");
    expect(qualityFlags({ front: "What is X? And why does it matter?", back: "A thing; it matters.", cardType: "explanation" })).toContain("compound_question");
  });
  it("flags answers visible in the prompt", () => {
    expect(qualityFlags({ front: "Why is retrieval practice better than rereading for retention?", back: "Retrieval practice.", cardType: "explanation" })).toContain("answer_in_prompt");
  });
  it("flags long and list answers and empty sides", () => {
    expect(qualityFlags({ front: "Q?", back: Array(80).fill("word").join(" "), cardType: "explanation" })).toContain("long_answer");
    expect(qualityFlags({ front: "Q?", back: "- a\n- b\n- c\n- d", cardType: "explanation" })).toContain("enumeration");
    expect(qualityFlags({ front: "", back: "x", cardType: "explanation" })).toEqual(["empty"]);
  });
  it("detects near-duplicate prompts, preferring earlier ones", () => {
    const d = duplicateIndices(
      ["Why do orphan questions make poor SRS items?", "How does spacing affect retention?", "Why do orphan questions make poor spaced repetition SRS items?"],
      [],
    );
    expect([...d]).toEqual([2]);
    expect([...duplicateIndices(["How does spacing affect retention?"], ["How does spacing affect long retention?"])]).toEqual([0]);
  });
});

describe("grounding", () => {
  const text = "Internalized knowledge greatly increases the number of associations available during thought. You cannot connect ideas you do not know.";
  it("accepts verbatim or lightly elided excerpts", () => {
    expect(isExcerptGrounded("Internalized knowledge greatly increases the number of associations", text)).toBe(true);
    expect(isExcerptGrounded("“internalized knowledge greatly increases the number of associations available during thought…”", text)).toBe(true);
  });
  it("rejects invented excerpts", () => {
    expect(isExcerptGrounded("Memory is the foundation of all scientific discovery according to Einstein", text)).toBe(false);
  });
});

describe("pasted highlights", () => {
  it("parses Kindle clippings with notes and duplicates", () => {
    const raw = `Deep Work (Cal Newport)
- Your Highlight on page 12 | Location 180-182 | Added on Monday

To produce at your peak level you need to work for extended periods with full concentration.
==========
Deep Work (Cal Newport)
- Your Note on page 12 | Location 182 | Added on Monday

compare with flow
==========
Deep Work (Cal Newport)
- Your Highlight on page 12 | Location 180-182 | Added on Monday

To produce at your peak level you need to work for extended periods with full concentration.
==========`;
    const passages = parsePastedHighlights(raw);
    expect(passages.map((p) => p.text).filter((t) => t.startsWith("To produce"))).toHaveLength(1);
    expect(passages.find((p) => p.text.startsWith("To produce"))!.note).toBe("compare with flow");
  });
  it("splits plain excerpts on blank lines", () => {
    expect(parsePastedHighlights("First excerpt\ncontinues here.\n\nSecond excerpt.\nNote: mine")).toEqual([
      { text: "First excerpt continues here.", note: null },
      { text: "Second excerpt.", note: "mine" },
    ]);
  });
});
