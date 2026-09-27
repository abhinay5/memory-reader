import { putCard, putSync, syncRecordsForCard } from "../storage/db";
import type { CardCandidate, MochiDeck, Source } from "../types";
import { newId } from "../utils/hashing";
import { MochiClient, MochiError } from "./api";
import { mochiTags, toMochiContent } from "./format";

export interface ExportOptions {
  includeSourceLink: boolean;
  autoSourceTags: boolean;
  /** Send even if already exported (the user chose "Send as new card"). */
  forceNew?: boolean;
}

export interface ExportResult {
  sent: CardCandidate[];
  failed: { card: CardCandidate; error: string }[];
  skipped: CardCandidate[];
  /** Set when a fatal error (bad key, offline) stopped the batch. */
  fatal: MochiError | null;
}

/** True if a card already has a Mochi card id — the guard against duplicate sends. */
export async function alreadyExported(card: CardCandidate): Promise<boolean> {
  const records = await syncRecordsForCard(card.id);
  return records.some((r) => r.syncStatus === "synced" && r.mochiCardId);
}

/**
 * Sends cards one at a time (Mochi allows one concurrent request per account), storing each
 * returned Mochi id immediately so that a retry after partial failure never resends a card.
 */
export async function exportCardsToMochi(
  client: MochiClient,
  items: { card: CardCandidate; source: Source }[],
  deck: MochiDeck,
  options: ExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const result: ExportResult = { sent: [], failed: [], skipped: [], fatal: null };
  let done = 0;
  for (const { card, source } of items) {
    if (result.fatal) {
      result.failed.push({ card, error: result.fatal.message });
      continue;
    }
    if (!options.forceNew && (await alreadyExported(card))) {
      result.skipped.push(card);
      onProgress?.(++done, items.length);
      continue;
    }
    try {
      const { id } = await client.createCard({
        content: toMochiContent(card, source, { includeSourceLink: options.includeSourceLink }),
        "deck-id": deck.id,
        "manual-tags": mochiTags(source, options.autoSourceTags),
        "review-reverse?": false,
      });
      await putSync({ id: newId("sync"), cardCandidateId: card.id, mochiCardId: id, mochiDeckId: deck.id, deckName: deck.name, syncStatus: "synced", syncedAt: Date.now(), error: null });
      const updated: CardCandidate = { ...card, status: "exported", editedAfterExport: false, updatedAt: Date.now() };
      await putCard(updated);
      result.sent.push(updated);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await putSync({ id: newId("sync"), cardCandidateId: card.id, mochiCardId: null, mochiDeckId: deck.id, deckName: deck.name, syncStatus: "failed", syncedAt: Date.now(), error });
      const updated: CardCandidate = { ...card, status: "failed", updatedAt: Date.now() };
      await putCard(updated);
      result.failed.push({ card: updated, error });
      if (err instanceof MochiError && (err.kind === "auth" || err.kind === "network" || err.kind === "not_found")) result.fatal = err;
    }
    onProgress?.(++done, items.length);
  }
  return result;
}
