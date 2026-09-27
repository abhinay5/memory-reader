# Memory Reader

A Chrome extension (Manifest V3, side panel) that turns what you read into carefully designed retrieval prompts and sends the ones you approve to [Mochi](https://mochi.cards).

It follows **source → highlights → ideas → cards**, not highlight → flashcard. Claude first works out what the source argues and which ideas deserve durable memory. It merges highlights that express the same idea and keeps attribution intact ("Nielsen argues…"). Only then does it design prompts. A second Claude pass reviews every card and revises or drops weak ones before you see them. You keep, edit, regenerate or reject each card, then send the approved ones to Mochi in one click.

Mochi cards come out as:

```
According to Michael Nielsen, why does internalized knowledge support creative thinking?
---
It increases the associations available during thought — you can't connect ideas you don't know.

_Source: [“Augmenting Long-term Memory”](https://…) — Michael Nielsen_
```

The prompt is on the front, and the answer plus the source link is on the back. There's no third `---` section, so the provenance line never becomes an extra review side. Reverse review is off.

## Install (unpacked)

```bash
npm install
npm run build          # outputs dist/
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Pin **Memory Reader** to the toolbar.
4. Open the extension's **Settings** (gear icon in the panel, or right-click the icon → Options):
   - **Claude**: paste your Anthropic API key and click *Test connection*. The default model is Claude Sonnet 5.
   - **Mochi**: paste your Mochi API key (Mochi → Account settings → API Keys), click *Test connection*, and pick a default deck.

No server, daemon or `localhost` process is involved. Chrome wakes the service worker when it's needed.

## Using it

- **Read and highlight.** Select text, then right-click → **Highlight selection** (or **Highlight + remember this** to get cards for that passage straight away). Highlights are saved locally and re-anchored on the page by quote plus surrounding context.
- **Generate from my highlights.** Click the toolbar icon and choose a study mode (Remember / Understand / Master). You'll see how your highlights were read (merged, context-only, not worth keeping) and a small set of candidate cards.
- **Analyze article.** Builds an article map (thesis plus the ideas worth remembering). Untick ideas you don't want, then generate cards.
- **Paste highlights.** Covers Kindle "My Clippings", book notes and PDF excerpts.
- **Curate.** Edit a card inline, Keep, Reject, or Regenerate it (rephrase / simpler / more conceptual / more precise / different angle).
- **Send to Mochi.** Cards that were already sent are never sent twice. After a partial failure you can retry only the failed cards or export them as CSV. **Export CSV** works without a Mochi API key: import it into Mochi with the first row as a header, and you get two columns, Front and Back.

Optional keyboard shortcuts can be set at `chrome://extensions/shortcuts`.

## Privacy and permissions

- Permissions: `activeTab`, `scripting`, `sidePanel`, `storage`, `contextMenus`, plus host access only for `api.anthropic.com` and `app.mochi.cards`. The extension reads a page only when you click it.
- Article text is sent to Anthropic only when you choose an action (Analyze, Generate, Remember). Only the extracted article is sent, never page chrome, other tabs or browsing history.
- API keys live in `chrome.storage.local` on this device, are never rendered into pages, and go only to their own provider.
- Everything else (sources, highlights, ideas, cards, sync records) is in IndexedDB. Settings has **Delete source data**, **Forget API keys** and **Clear all local data**. Deleting local data never deletes cards from Mochi.
- *Show my highlights automatically when I revisit a page* is opt-in. It asks for broader page access, because `activeTab` access ends when a page reloads. Without it, highlights reappear when you click the icon.

## Development

```bash
npm run typecheck
npm test               # unit + integration tests (jsdom, fake IndexedDB, AI fixtures; no network)
npm run test:e2e       # loads dist/ into Chromium with Playwright, mocks Claude + Mochi
```

`test:e2e` needs Playwright and a Chromium build. Set `CHROMIUM_PATH` if yours isn't at the default location.

```
src/
  background/   service worker: context menus, commands, highlight capture, restore
  content/      article extraction (Readability), text anchoring, highlight rendering, selection context
  sidepanel/    React side panel (source, ideas, cards, paste, library)
  settings/     options page
  ai/           provider interface, Claude client (structured outputs), prompts, schemas, pipeline, card checks
  mochi/        API client, Markdown card format, CSV, idempotent export
  storage/      IndexedDB + chrome.storage settings
  core/         sources, tabs, paste parsing
```

The AI layer sits behind the `AIProvider` interface (`analyzeSource`, `generateCards`, `reviewCards`, `regenerateCard`) and a thin `StructuredLLM`. You could later swap direct API calls for a serverless proxy without touching the UI or the learning model.

### Pipeline

1. **Comprehend and select ideas** (Claude, structured JSON). Returns the thesis, a summary, candidate ideas with type, epistemic status, attribution, centrality and verbatim evidence, and an interpretation of every highlight. Long sources (over ~180k chars) are condensed section by section first; highlighted sections stay in full.
2. **Grounding check** (local). An idea only becomes a card if its evidence can be found in the source.
3. **Design prompts** (Claude). One retrievable unit per card, understandable months later, attribution kept, concise answers. The card budget is a ceiling, never a target.
4. **Quality review** (Claude plus deterministic checks). Each card is kept, revised or dropped. Near-duplicates, including ones matching cards made earlier for the same source, are removed.

Every model response is validated with Zod. If a response can't be parsed, the call is retried once automatically. Results are saved after every stage, so a failure never loses earlier work.
