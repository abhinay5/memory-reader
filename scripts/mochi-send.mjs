// Sends approved cards to Mochi from the command line (used when making cards in a Claude Code
// session instead of the extension). Reads the key from MOCHI_API_KEY.
//
//   node scripts/mochi-send.mjs decks                 # list decks
//   node scripts/mochi-send.mjs send cards.json       # send cards
//
// cards.json: { "deck": "ARTICLES" | "<deck-id>", "source": { "title", "author"?, "url"? },
//               "tags"?: string[], "cards": [{ "front": "...", "back": "..." }] }

import { readFileSync } from "node:fs";

const key = process.env.MOCHI_API_KEY;
if (!key) {
  console.error("MOCHI_API_KEY is not set.");
  process.exit(1);
}
const BASE = "https://app.mochi.cards/api";
const headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" };

async function request(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Mochi ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
}

async function listDecks() {
  const all = new Map();
  let bookmark;
  for (let i = 0; i < 50; i++) {
    const res = await request(`/decks/${bookmark ? `?bookmark=${encodeURIComponent(bookmark)}` : ""}`);
    for (const d of res.docs) all.set(d.id, d);
    if (!res.docs.length || !res.bookmark || res.bookmark === bookmark) break;
    bookmark = res.bookmark;
  }
  return [...all.values()].filter((d) => !d["trashed?"] && !d["archived?"]);
}

// Same format as the extension: prompt front, answer + provenance back, never a third side.
const noSeparators = (t) => t.replace(/\r\n?/g, "\n").split("\n").map((l) => (/^\s*-{3,}\s*$/.test(l) ? "—" : l)).join("\n").trim();
const esc = (t) => t.replace(/([\\[\]])/g, "\\$1");
function content(card, source) {
  const title = `“${esc(source.title)}”`;
  const titled = source.url ? `[${title}](${source.url.replace(/\)/g, "%29").replace(/ /g, "%20")})` : title;
  return `${noSeparators(card.front)}\n---\n${noSeparators(card.back)}\n\n_Source: ${titled}${source.author ? ` — ${esc(source.author)}` : ""}_`;
}
const slug = (t) => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

const [cmd, file] = process.argv.slice(2);
if (cmd === "decks") {
  for (const d of await listDecks()) console.log(`${d.id}\t${d.name}`);
} else if (cmd === "send" && file) {
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const decks = await listDecks();
  const deck = decks.find((d) => d.id === spec.deck) ?? decks.find((d) => d.name.toLowerCase() === String(spec.deck).toLowerCase());
  if (!deck) throw new Error(`Deck "${spec.deck}" not found. Available: ${decks.map((d) => d.name).join(", ")}`);
  const tags = spec.tags ?? ["generated", "reading", ...(spec.source.author ? [slug(spec.source.author.split(/,| and | & /i)[0])] : [])];
  let sent = 0;
  for (const [i, card] of spec.cards.entries()) {
    try {
      const res = await request("/cards/", { method: "POST", body: JSON.stringify({ content: content(card, spec.source), "deck-id": deck.id, "manual-tags": tags, "review-reverse?": false }) });
      sent++;
      console.log(`✓ ${i + 1}. ${card.front}  (${res.id})`);
    } catch (err) {
      console.log(`✗ ${i + 1}. ${card.front}  — ${err.message}`);
    }
  }
  console.log(`\n${sent} of ${spec.cards.length} cards added to ${deck.name}.`);
  if (sent < spec.cards.length) process.exit(1);
} else {
  console.log("Usage: node scripts/mochi-send.mjs decks | send <cards.json>");
}
