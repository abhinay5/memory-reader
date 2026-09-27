import type { MochiDeck } from "../types";

const BASE = "https://app.mochi.cards/api";

export type MochiErrorKind = "auth" | "network" | "rate_limit" | "not_found" | "invalid" | "server";

export class MochiError extends Error {
  constructor(
    public readonly kind: MochiErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MochiError";
  }
}

export interface CreateCardPayload {
  content: string;
  "deck-id": string;
  "manual-tags": string[];
  "review-reverse?": boolean;
}

interface RawDeck {
  id: string;
  name: string;
  "parent-id"?: string | null;
  "trashed?"?: unknown;
  "archived?"?: boolean;
  sort?: number;
}

export class MochiClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}${path}`, {
        ...init,
        headers: {
          // Basic auth with the key as username and no password. Only ever sent to Mochi.
          Authorization: `Basic ${btoa(`${this.apiKey}:`)}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new MochiError("network", "Mochi could not be reached. Your approved cards are still saved locally.");
    }
    if (res.status === 429 && attempt < 3) {
      // Mochi allows one concurrent request per account; back off briefly and retry.
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return this.request<T>(path, init, attempt + 1);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new MochiError("auth", "Mochi rejected the API key. Check the key in Settings or export these cards as CSV.", res.status);
      }
      if (res.status === 404) throw new MochiError("not_found", "Mochi couldn't find that deck. Choose another deck.", res.status);
      if (res.status === 429) throw new MochiError("rate_limit", "Mochi is rate-limiting requests. Retry in a moment.", res.status);
      if (res.status >= 500) throw new MochiError("server", `Mochi had a server error (${res.status}). Retry later.`, res.status);
      throw new MochiError("invalid", `Mochi rejected the request (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`, res.status);
    }
    return (await res.json()) as T;
  }

  async listDecks(): Promise<MochiDeck[]> {
    const raw: RawDeck[] = [];
    let bookmark: string | undefined;
    for (let page = 0; page < 50; page++) {
      const q = bookmark ? `?bookmark=${encodeURIComponent(bookmark)}` : "";
      const res = await this.request<{ docs: RawDeck[]; bookmark?: string }>(`/decks/${q}`);
      raw.push(...res.docs);
      if (!res.docs.length || !res.bookmark || res.bookmark === bookmark) break;
      bookmark = res.bookmark;
    }
    return buildDeckList(raw);
  }

  async createCard(payload: CreateCardPayload): Promise<{ id: string }> {
    const res = await this.request<{ id: string }>("/cards/", { method: "POST", body: JSON.stringify(payload) });
    if (!res?.id) throw new MochiError("invalid", "Mochi accepted the card but returned no id.");
    return { id: res.id };
  }
}

/** Flattens nested decks into "Parent / Child" names, excluding trashed and archived decks. */
export function buildDeckList(raw: RawDeck[]): MochiDeck[] {
  // Dedupe by id: a paginated listing can repeat a page before the bookmark stops advancing.
  const unique = [...new Map(raw.map((d) => [d.id, d])).values()];
  const live = unique.filter((d) => !d["trashed?"] && !d["archived?"]);
  const byId = new Map(live.map((d) => [d.id, d]));
  const pathName = (d: RawDeck, depth = 0): string => {
    const parent = d["parent-id"] ? byId.get(d["parent-id"]) : undefined;
    return parent && depth < 10 ? `${pathName(parent, depth + 1)} / ${d.name}` : d.name;
  };
  return live.map((d) => ({ id: d.id, name: pathName(d) })).sort((a, b) => a.name.localeCompare(b.name));
}
