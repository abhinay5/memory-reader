// End-to-end smoke test: loads the built extension into Chromium, highlights passages on a local
// article, runs "Generate from highlights" against a mocked Claude API, and sends the cards to a
// mocked Mochi API. No real API keys or network access are needed.
//
//   npm run build && node scripts/e2e-smoke.mjs [--screenshots <dir>]
//
// Requires Playwright (`npm i -D playwright` or a global install) and a Chromium build.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(join(process.env.PLAYWRIGHT_GLOBAL ?? "/opt/node22/lib/node_modules", "playwright"));
}

const shotsArg = process.argv.indexOf("--screenshots");
const shotsDir = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const shot = async (page, name) => shotsDir && page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true });

const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "memory-reader-e2e-"));
const extDir = join(work, "ext");
cpSync(join(root, "dist"), extDir, { recursive: true });
// Test-only: grant host access up front, since automation can't click the toolbar icon (activeTab).
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
writeFileSync(join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const articleHtml = readFileSync(join(root, "tests/fixtures/article.html"), "utf8");
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(articleHtml);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const articleUrl = `http://127.0.0.1:${server.address().port}/essays/augmenting-memory?utm_source=newsletter`;

// ---- Mocked Claude responses (keyed by pipeline stage) ----------------------------------
const analysis = {
  thesis: "Nielsen argues that spaced repetition can make memory a deliberate tool for creative and intellectual work.",
  summary: "The essay describes a memory system and argues that internalized knowledge supports creative association, while isolated questions become useless orphans.",
  ideas: [
    {
      key: "i1",
      statement: "Nielsen argues that internalized knowledge increases the associations available during thought, which supports creative work.",
      explanation: "You cannot connect ideas you do not know; looking things up interrupts creative association.",
      importance_reason: "central to the thesis",
      idea_type: "claim",
      epistemic_status: "author_claim",
      attribution: "Michael Nielsen",
      centrality: "central",
      evidence: [
        { highlight_id: "h1", excerpt: "Internalized knowledge greatly increases the number of associations available during thought." },
        { highlight_id: "h2", excerpt: "You cannot connect ideas you do not know" },
      ],
    },
    {
      key: "i2",
      statement: "Isolated 'orphan' questions are hard to remember and of little use because they lack connections to other knowledge.",
      explanation: "Approaching an important idea from several related directions makes it easier to retain.",
      importance_reason: "explains a failure mode of flashcards",
      idea_type: "mechanism",
      epistemic_status: "author_claim",
      attribution: "Michael Nielsen",
      centrality: "supporting",
      evidence: [{ highlight_id: "h3", excerpt: "Isolated questions tend to become orphans: difficult to remember and of little use" }],
    },
  ],
  highlight_interpretations: [
    { highlight_id: "h1", disposition: "became_idea", relation: "core", idea_keys: ["i1"], note: "" },
    { highlight_id: "h2", disposition: "merged", relation: "supporting_evidence", idea_keys: ["i1"], note: "Same idea as the previous highlight." },
    { highlight_id: "h3", disposition: "became_idea", relation: "core", idea_keys: ["i2"], note: "" },
  ],
};
const cards = {
  cards: [
    { idea_key: "i1", front: "According to Michael Nielsen, why does internalized knowledge support creative thinking?", back: "It increases the associations available during thought — you can't connect ideas you don't know.", card_type: "source_claim", source_excerpt: "Internalized knowledge greatly increases the number of associations available during thought.", confidence: "high" },
    { idea_key: "i1", front: "Why, on Nielsen's view, can't looking things up replace remembering them during creative work?", back: "Lookup interrupts the flow that creative association depends on, and you can't look up a connection you don't know exists.", card_type: "explanation", source_excerpt: "looking things up interrupts the flow that creative association depends upon.", confidence: "medium" },
    { idea_key: "i2", front: "What is an orphan question?", back: "A question lacking connections.", card_type: "definition", source_excerpt: "Isolated questions tend to become orphans", confidence: "medium" },
    { idea_key: "i1", front: "What do memory systems make memory?", back: "A choice.", card_type: "definition", source_excerpt: "", confidence: "low" },
  ],
  ideas_without_cards: [],
};
const review = {
  reviews: [
    { card_id: "c1", verdict: "keep", problems: [], reason: "", revised_front: null, revised_back: null },
    { card_id: "c2", verdict: "keep", problems: [], reason: "", revised_front: null, revised_back: null },
    { card_id: "c3", verdict: "revise", problems: ["context_dependent"], reason: "Needs attribution.", revised_front: "Why does Michael Nielsen consider isolated “orphan” questions poor spaced-repetition items?", revised_back: "They lack connections to anything else you understand, so they're hard to remember and of little use." },
    { card_id: "c4", verdict: "drop", problems: ["tests_wording"], reason: "Sentence transformation.", revised_front: null, revised_back: null },
  ],
};

function sse(json) {
  const events = [
    ["message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: JSON.stringify(json) } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 100 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

const claudeRequests = [];
const mochiCards = [];
const failures = [];
const check = (cond, message) => {
  if (cond) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}`);
    failures.push(message);
  }
};

const context = await playwright.chromium.launchPersistentContext(join(work, "profile"), {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-proxy-server"],
  viewport: { width: 420, height: 900 },
});

try {
  await context.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() ?? "{}");
    claudeRequests.push({ headers: req.headers(), body });
    const system = String(body.system ?? "");
    const payload = system.includes("STAGE: comprehension") ? analysis : system.includes("STAGE: prompt design") ? cards : system.includes("STAGE: quality control") ? review : null;
    if (!payload) return route.fulfill({ status: 400, body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "unexpected" } }) });
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse(payload) });
  });
  await context.route("https://app.mochi.cards/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: [{ id: "deck1", name: "Reading" }, { id: "deck2", name: "Essays", "parent-id": "deck1" }], bookmark: "b1" }) });
    }
    const body = JSON.parse(req.postData() ?? "{}");
    mochiCards.push({ body, auth: req.headers()["authorization"] });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: `mochi_${mochiCards.length}` }) });
  });

  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  console.log(`Extension loaded: ${extId}`);

  const article = await context.newPage();
  await article.goto(articleUrl);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, articleUrl);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { anthropicApiKey: "sk-ant-test-key", model: "claude-sonnet-5", mochiApiKey: "mochi-test-key", defaultDeckId: "deck1", defaultDeckName: "Reading", studyMode: "understand", autoSourceTags: true, includeSourceLink: true, autoRestoreHighlights: false } }),
  );
  await panel.reload();

  console.log("Phase 1 — extraction");
  await panel.getByRole("heading", { level: 1 }).waitFor();
  check((await panel.getByRole("heading", { level: 1 }).textContent()) === "Augmenting Long-term Memory", "title recognised (site suffix removed)");
  check((await panel.locator(".byline").textContent()).includes("Michael Nielsen"), "author recognised");
  check(/\d+ words/.test(await panel.locator(".stats").textContent()), "word count shown");
  await shot(panel, "1-initial");

  console.log("Phase 2 — highlighting");
  const passages = [
    "Internalized knowledge greatly increases the number of associations available during thought.",
    "You cannot connect ideas you do not know",
    "Isolated questions tend to become orphans: difficult to remember and of little use",
  ];
  for (const text of passages) {
    await article.evaluate((t) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.data.includes(t)) node = walker.nextNode();
      const start = node.data.indexOf(t);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + t.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, text);
    await panel.getByRole("button", { name: "Highlight selection" }).click();
    await panel.waitForFunction((n) => document.querySelectorAll(".highlight").length >= n, passages.indexOf(text) + 1);
  }
  check((await article.locator("mark.memory-reader-hl").count()) >= 3, "highlights rendered on the page");
  check((await panel.locator(".highlight").count()) === 3, "three highlights listed in the panel");
  const sectionShown = await panel.locator(".highlight .meta").first().textContent();
  check(sectionShown.includes("The role of memory in creative work"), "section heading captured for highlight");

  await article.reload();
  await panel.waitForTimeout(1500);
  const restored = await article.locator("mark.memory-reader-hl").count();
  check(restored >= 3, `highlights restored after reload (${restored} marks)`);

  console.log("Phase 3 — generate from highlights (mocked Claude)");
  await panel.getByRole("button", { name: /Generate from 3 highlights/ }).click();
  await panel.locator(".cards-view").waitFor({ timeout: 20000 });
  await shot(panel, "2-cards");
  const analysisReq = claudeRequests.find((r) => String(r.body.system).includes("STAGE: comprehension"));
  check(!!analysisReq, "analysis request sent");
  check(analysisReq?.headers["x-api-key"] === "sk-ant-test-key", "Anthropic key sent only in x-api-key header to api.anthropic.com");
  check(analysisReq?.headers["anthropic-dangerous-direct-browser-access"] === "true", "direct browser access header set");
  check(analysisReq?.body.model === "claude-sonnet-5", "configured model used");
  check(analysisReq?.body.output_config?.format?.type === "json_schema", "structured output schema requested");
  const userMsg = analysisReq?.body.messages?.[0]?.content ?? "";
  check(userMsg.includes('<highlight id="h1"') && userMsg.includes("<before>") && userMsg.includes("<article>"), "highlights sent with surrounding context and article");
  check(!userMsg.includes("cookies") && !userMsg.includes("productivity hacks"), "page chrome not sent to the model");
  check((await panel.locator(".interpretation .flow").textContent()).includes("3 highlights → 2 ideas"), "interpretation summary shown");
  const fronts = await panel.locator(".card .front textarea").evaluateAll((els) => els.map((e) => e.value));
  check(fronts.length === 3, `3 cards after review (got ${fronts.length})`);
  check(!fronts.includes("What do memory systems make memory?"), "sentence-transformation card dropped by review");
  check(fronts.some((f) => f.startsWith("Why does Michael Nielsen consider isolated")), "vague card revised by review");

  console.log("Phase 4 — curate");
  const second = panel.locator(".card").nth(1);
  await second.locator("textarea").nth(1).fill("Lookup breaks the flow creative association needs, and you can't look up a link you don't know exists.");
  await second.locator("textarea").nth(1).blur();
  await panel.locator(".card").nth(2).getByRole("button", { name: "Reject" }).click();
  await panel.getByRole("button", { name: /Keep all 2 to review/ }).click();
  await panel.getByRole("button", { name: /Send 2 cards to Mochi/ }).waitFor();

  console.log("Phase 5 — send to Mochi (mocked)");
  await panel.getByRole("button", { name: /Send 2 cards to Mochi/ }).click();
  await panel.locator(".notice.success").waitFor({ timeout: 10000 });
  await shot(panel, "3-sent");
  check(mochiCards.length === 2, "two cards created in Mochi");
  const content = mochiCards[0]?.body.content ?? "";
  const sides = content.split(/^---$/m);
  check(sides.length === 2, "exactly two sides (prompt front, answer back)");
  check(sides[0].trim().endsWith("?"), "front side is the prompt");
  check(/_Source: \[“Augmenting Long-term Memory”\]\(http:\/\/127\.0\.0\.1:\d+\/essays\/augmenting-memory\?utm_source=newsletter\) — Michael Nielsen_/.test(sides[1]), "back has source link");
  check(mochiCards[0]?.body["deck-id"] === "deck1" && mochiCards[0]?.body["review-reverse?"] === false, "deck id set, reverse review off");
  check(mochiCards[0]?.auth === `Basic ${Buffer.from("mochi-test-key:").toString("base64")}`, "Mochi basic auth");
  check(mochiCards.some((c) => c.body.content.includes("Lookup breaks the flow")), "user edit was sent");
  check((await panel.locator(".notice.success").textContent()).includes("2 cards added to Reading"), "success message names deck");
  check(await panel.getByRole("button", { name: /Sent ✓/ }).isDisabled(), "send button becomes Sent ✓");
  const before = mochiCards.length;
  await panel.reload();
  await panel.getByRole("button", { name: /Cards/ }).click();
  check(mochiCards.length === before, "no duplicates after reload");

  console.log("Phase 6 — article analysis");
  await panel.getByRole("button", { name: "Source" }).click();
  await panel.getByRole("button", { name: "Analyze article" }).click();
  await panel.locator(".ideas-view").waitFor({ timeout: 20000 });
  await shot(panel, "4-ideas");
  const overflow = await panel.evaluate(() => [...document.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map((el) => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().right)}`).slice(0, 8));
  check(overflow.length === 0, `no horizontal overflow ${overflow.join(", ")}`);
  check((await panel.locator(".idea").count()) === 2, "article map lists ideas");
  check((await panel.locator(".thesis").textContent()).includes("Nielsen argues"), "thesis shown");

  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extId}/settings.html`);
  await settings.getByText("Connected — 2 decks found.").waitFor({ timeout: 10000 });
  check(true, "settings page connects to Mochi and lists decks");
  check(!(await settings.content()).includes("sk-ant-test-key"), "API key never rendered into the DOM");
  await shot(settings, "5-settings");
} finally {
  await context.close();
  server.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll end-to-end checks passed.");
