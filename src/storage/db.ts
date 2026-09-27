import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CardCandidate, GenerationRun, Highlight, Idea, MochiSync, Source } from "../types";

// IndexedDB is shared by every extension context (side panel, settings page, service worker)
// because they all run on the extension's origin. Content scripts go through the service worker.

interface MemoryReaderDB extends DBSchema {
  sources: { key: string; value: Source; indexes: { byUpdated: number } };
  highlights: { key: string; value: Highlight; indexes: { bySource: string } };
  ideas: { key: string; value: Idea; indexes: { bySource: string; byRun: string } };
  cards: { key: string; value: CardCandidate; indexes: { bySource: string; byIdea: string; byRun: string } };
  runs: { key: string; value: GenerationRun; indexes: { bySource: string } };
  sync: { key: string; value: MochiSync; indexes: { byCard: string } };
}

const DB_NAME = "memory-reader";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MemoryReaderDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<MemoryReaderDB>> {
  dbPromise ??= openDB<MemoryReaderDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore("sources", { keyPath: "id" }).createIndex("byUpdated", "updatedAt");
      db.createObjectStore("highlights", { keyPath: "id" }).createIndex("bySource", "sourceId");
      const ideas = db.createObjectStore("ideas", { keyPath: "id" });
      ideas.createIndex("bySource", "sourceId");
      ideas.createIndex("byRun", "runId");
      const cards = db.createObjectStore("cards", { keyPath: "id" });
      cards.createIndex("bySource", "sourceId");
      cards.createIndex("byIdea", "ideaId");
      cards.createIndex("byRun", "runId");
      db.createObjectStore("runs", { keyPath: "id" }).createIndex("bySource", "sourceId");
      db.createObjectStore("sync", { keyPath: "id" }).createIndex("byCard", "cardCandidateId");
    },
  });
  return dbPromise;
}

/** Test hook: forget the cached connection (used with fake-indexeddb resets). */
export function resetDbConnection(): void {
  dbPromise = null;
}

// ---- Sources ----------------------------------------------------------------------------

export async function getSource(id: string): Promise<Source | undefined> {
  return (await getDb()).get("sources", id);
}

export async function putSource(source: Source): Promise<void> {
  await (await getDb()).put("sources", source);
}

export async function listSources(): Promise<Source[]> {
  const all = await (await getDb()).getAllFromIndex("sources", "byUpdated");
  return all.reverse();
}

/** Removes every local record for a source. Cards already sent to Mochi are untouched there. */
export async function deleteSourceData(sourceId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["sources", "highlights", "ideas", "cards", "runs", "sync"], "readwrite");
  const cardIds = await tx.objectStore("cards").index("bySource").getAllKeys(sourceId);
  for (const cardId of cardIds) {
    for (const syncKey of await tx.objectStore("sync").index("byCard").getAllKeys(cardId)) {
      await tx.objectStore("sync").delete(syncKey);
    }
    await tx.objectStore("cards").delete(cardId);
  }
  for (const store of ["highlights", "ideas", "runs"] as const) {
    for (const key of await tx.objectStore(store).index("bySource").getAllKeys(sourceId)) {
      await tx.objectStore(store).delete(key);
    }
  }
  await tx.objectStore("sources").delete(sourceId);
  await tx.done;
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const stores = ["sources", "highlights", "ideas", "cards", "runs", "sync"] as const;
  const tx = db.transaction([...stores], "readwrite");
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

// ---- Highlights -------------------------------------------------------------------------

export async function highlightsForSource(sourceId: string): Promise<Highlight[]> {
  const all = await (await getDb()).getAllFromIndex("highlights", "bySource", sourceId);
  return all.sort((a, b) => (a.anchorData?.start ?? a.createdAt) - (b.anchorData?.start ?? b.createdAt));
}

export async function putHighlight(highlight: Highlight): Promise<void> {
  await (await getDb()).put("highlights", highlight);
}

export async function getHighlight(id: string): Promise<Highlight | undefined> {
  return (await getDb()).get("highlights", id);
}

export async function deleteHighlight(id: string): Promise<void> {
  await (await getDb()).delete("highlights", id);
}

// ---- Ideas ------------------------------------------------------------------------------

export async function ideasForSource(sourceId: string): Promise<Idea[]> {
  return (await getDb()).getAllFromIndex("ideas", "bySource", sourceId);
}

export async function ideasForRun(runId: string): Promise<Idea[]> {
  return (await getDb()).getAllFromIndex("ideas", "byRun", runId);
}

export async function putIdeas(ideas: Idea[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("ideas", "readwrite");
  await Promise.all([...ideas.map((i) => tx.store.put(i)), tx.done]);
}

// ---- Cards ------------------------------------------------------------------------------

export async function cardsForSource(sourceId: string): Promise<CardCandidate[]> {
  const all = await (await getDb()).getAllFromIndex("cards", "bySource", sourceId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getCard(id: string): Promise<CardCandidate | undefined> {
  return (await getDb()).get("cards", id);
}

export async function putCard(card: CardCandidate): Promise<void> {
  await (await getDb()).put("cards", card);
}

export async function putCards(cards: CardCandidate[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("cards", "readwrite");
  await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done]);
}

// ---- Runs -------------------------------------------------------------------------------

export async function putRun(run: GenerationRun): Promise<void> {
  await (await getDb()).put("runs", run);
}

export async function getRun(id: string): Promise<GenerationRun | undefined> {
  return (await getDb()).get("runs", id);
}

export async function runsForSource(sourceId: string): Promise<GenerationRun[]> {
  const all = await (await getDb()).getAllFromIndex("runs", "bySource", sourceId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

// ---- Mochi sync -------------------------------------------------------------------------

export async function putSync(record: MochiSync): Promise<void> {
  await (await getDb()).put("sync", record);
}

export async function syncRecordsForCard(cardId: string): Promise<MochiSync[]> {
  const all = await (await getDb()).getAllFromIndex("sync", "byCard", cardId);
  return all.sort((a, b) => a.syncedAt - b.syncedAt);
}
