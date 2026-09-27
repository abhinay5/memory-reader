import { beforeEach, describe, expect, it } from "vitest";
import { buildDeckList, MochiClient, MochiError } from "../src/mochi/api";
import { cardsToCsv, csvEscape } from "../src/mochi/csv";
import { exportCardsToMochi } from "../src/mochi/export";
import { mochiTags, neutralizeSideSeparators, toMochiContent } from "../src/mochi/format";
import { clearAllData, getCard, putCard, syncRecordsForCard } from "../src/storage/db";
import type { CardCandidate, Source } from "../src/types";

const source = { title: "Augmenting Long-term Memory", author: "Michael Nielsen", url: "https://example.com/memory", site: "Example Essays", sourceType: "web_article" as const };

describe("Mochi card format", () => {
  it("puts the prompt on the front and answer + provenance on the back", () => {
    const content = toMochiContent({ front: "Why do orphan questions make poor SRS items?", back: "They lack connections, so they are hard to recall and of little use." }, source, { includeSourceLink: true });
    expect(content).toBe(
      "Why do orphan questions make poor SRS items?\n---\nThey lack connections, so they are hard to recall and of little use.\n\n_Source: [“Augmenting Long-term Memory”](https://example.com/memory) — Michael Nielsen_",
    );
    // Exactly two sides.
    expect(content.split(/^---$/m)).toHaveLength(2);
  });

  it("never lets card text create extra sides", () => {
    const content = toMochiContent({ front: "Q\n---\nmore", back: "A\n  ---  \nB" }, source, { includeSourceLink: false });
    expect(content.split(/^---$/m)).toHaveLength(2);
    expect(neutralizeSideSeparators("a\n----\nb")).toBe("a\n—\nb");
    expect(content).toContain("_Source: “Augmenting Long-term Memory” — Michael Nielsen_");
  });

  it("escapes brackets in titles used as link text", () => {
    const content = toMochiContent({ front: "Q", back: "A" }, { ...source, title: "Notes [draft]" }, { includeSourceLink: true });
    expect(content).toContain("[“Notes \\[draft\\]”](https://example.com/memory)");
  });

  it("creates a small, stable tag set", () => {
    expect(mochiTags({ author: "Michael Nielsen, Andy Matuschak", site: "Example Essays", sourceType: "web_article" }, true)).toEqual(["generated", "reading", "michael-nielsen", "example-essays"]);
    expect(mochiTags({ author: "Michael Nielsen", site: "x.com", sourceType: "web_article" }, false)).toEqual(["generated", "reading"]);
  });
});

describe("CSV fallback", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvEscape('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("two\nlines")).toBe('"two\nlines"');
  });

  it("has exactly two columns with provenance on the back", () => {
    const csv = cardsToCsv([{ card: { front: "Why, exactly?", back: 'Because "reasons".' }, source }], { includeSourceLink: true });
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("Front,Back");
    expect(row.startsWith('"Why, exactly?","Because ""reasons"".\n\nSource:')).toBe(true);
    expect(csv).toContain("Source: Augmenting Long-term Memory — Michael Nielsen\nhttps://example.com/memory\"");
  });
});

describe("deck list", () => {
  it("flattens nested decks and hides trashed/archived ones", () => {
    const decks = buildDeckList([
      { id: "a", name: "Reading" },
      { id: "b", name: "Essays", "parent-id": "a" },
      { id: "c", name: "Old", "trashed?": "2024-01-01" },
      { id: "d", name: "Archive", "archived?": true },
      { id: "a", name: "Reading" },
    ]);
    expect(decks).toEqual([
      { id: "a", name: "Reading" },
      { id: "b", name: "Reading / Essays" },
    ]);
  });
});

function card(id: string, status: CardCandidate["status"] = "approved"): CardCandidate {
  const now = Date.now();
  return { id, sourceId: "src_1", ideaId: "idea_1", runId: "run_1", front: `Question ${id}?`, back: `Answer ${id}.`, cardType: "explanation", sourceEvidence: "", confidence: "high", qualityFlags: [], status, originalFront: "", originalBack: "", editedByUser: false, editedAfterExport: false, createdAt: now, updatedAt: now };
}

function fakeMochi(failOn: Set<string> = new Set(), status = 500) {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body, auth: new Headers(init?.headers).get("Authorization") ?? "" });
    if (String(body.content ?? "").split("\n")[0] && [...failOn].some((f) => String(body.content).startsWith(`Question ${f}?`))) {
      return new Response("boom", { status });
    }
    return new Response(JSON.stringify({ id: `m_${calls.length}` }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new MochiClient("KEY123", fetchImpl), calls };
}

describe("Mochi export", () => {
  const src = { ...source, id: "src_1" } as unknown as Source;
  const deck = { id: "deck1", name: "Reading" };
  const opts = { includeSourceLink: true, autoSourceTags: true };

  beforeEach(async () => {
    await clearAllData();
  });

  it("sends cards with basic auth, deck id, tags and no reverse review, and stores Mochi ids", async () => {
    const cards = [card("1"), card("2")];
    for (const c of cards) await putCard(c);
    const { client, calls } = fakeMochi();
    const res = await exportCardsToMochi(client, cards.map((c) => ({ card: c, source: src })), deck, opts);
    expect(res.sent).toHaveLength(2);
    expect(calls[0].url).toBe("https://app.mochi.cards/api/cards/");
    expect(calls[0].auth).toBe(`Basic ${btoa("KEY123:")}`);
    expect(calls[0].body).toMatchObject({ "deck-id": "deck1", "review-reverse?": false, "manual-tags": ["generated", "reading", "michael-nielsen", "example-essays"] });
    expect((await getCard("1"))!.status).toBe("exported");
    expect((await syncRecordsForCard("1"))[0]).toMatchObject({ mochiCardId: "m_1", syncStatus: "synced", mochiDeckId: "deck1" });
  });

  it("never resends cards that already have a Mochi id", async () => {
    const cards = [card("1"), card("2")];
    for (const c of cards) await putCard(c);
    const { client, calls } = fakeMochi();
    await exportCardsToMochi(client, cards.map((c) => ({ card: c, source: src })), deck, opts);
    const again = await exportCardsToMochi(client, cards.map((c) => ({ card: c, source: src })), deck, opts);
    expect(calls).toHaveLength(2);
    expect(again.skipped).toHaveLength(2);
    expect(again.sent).toHaveLength(0);
  });

  it("handles partial failure and retries only the failed cards", async () => {
    const cards = [card("1"), card("2"), card("3")];
    for (const c of cards) await putCard(c);
    const first = fakeMochi(new Set(["2"]));
    const res = await exportCardsToMochi(first.client, cards.map((c) => ({ card: c, source: src })), deck, opts);
    expect(res.sent.map((c) => c.id)).toEqual(["1", "3"]);
    expect(res.failed.map((f) => f.card.id)).toEqual(["2"]);
    expect((await getCard("2"))!.status).toBe("failed");

    const retry = fakeMochi();
    const all = await Promise.all(["1", "2", "3"].map((id) => getCard(id)));
    const res2 = await exportCardsToMochi(retry.client, all.map((c) => ({ card: c!, source: src })), deck, opts);
    expect(retry.calls).toHaveLength(1);
    expect(res2.sent.map((c) => c.id)).toEqual(["2"]);
  });

  it("stops the batch on an invalid key", async () => {
    const cards = [card("1"), card("2")];
    for (const c of cards) await putCard(c);
    const { client, calls } = fakeMochi(new Set(["1", "2"]), 401);
    const res = await exportCardsToMochi(client, cards.map((c) => ({ card: c, source: src })), deck, opts);
    expect(calls).toHaveLength(1);
    expect(res.fatal).toBeInstanceOf(MochiError);
    expect(res.fatal!.kind).toBe("auth");
    expect(res.failed).toHaveLength(2);
  });

  it("can deliberately send an edited card as a new card", async () => {
    const c = card("1");
    await putCard(c);
    const { client, calls } = fakeMochi();
    await exportCardsToMochi(client, [{ card: c, source: src }], deck, opts);
    const edited = { ...(await getCard("1"))!, back: "Better answer.", editedAfterExport: true };
    const res = await exportCardsToMochi(client, [{ card: edited, source: src }], deck, { ...opts, forceNew: true });
    expect(calls).toHaveLength(2);
    expect(res.sent[0].editedAfterExport).toBe(false);
  });
});
