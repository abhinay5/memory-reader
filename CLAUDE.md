# Memory Reader

Chrome extension (see README.md) plus a chat workflow for turning reading into Mochi cards.

## Making cards in a Claude Code session (no extension)

When the user pastes highlights or an article and wants cards:

1. Follow `docs/claude-project-instructions.md` exactly for Steps 1–3: understand first, group highlights into ideas, write cards by its rules, then show the main idea, how the highlights were read, and a numbered Q/A list. Revise on requests like "drop 3" / "simpler 5".
2. Never send anything to Mochi until the user explicitly says to send (e.g. "send to ARTICLES").
3. To send: write the approved cards to a JSON file in the scratchpad (never in the repo) and run
   `node scripts/mochi-send.mjs send <file>` — see the header of that script for the JSON shape.
   `node scripts/mochi-send.mjs decks` lists decks. The key comes from the `MOCHI_API_KEY` environment variable;
   never ask the user to paste keys into the chat. Report which cards were added; don't resend ones that succeeded.
4. Cards must keep the Mochi format: prompt on the front, answer + source line on the back (the script handles this).

## Development

`npm install`, `npm run build` (outputs `dist/`), `npm test`, `npm run test:e2e`.
