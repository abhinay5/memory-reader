import { useEffect, useState } from "react";
import { cardsForSource, highlightsForSource, listSources } from "../../storage/db";
import type { Source } from "../../types";
import type { Reader } from "../useReader";

interface Row {
  source: Source;
  highlights: number;
  cards: number;
  sent: number;
}

export function LibraryView({ reader }: { reader: Reader }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    void (async () => {
      const sources = await listSources();
      const out: Row[] = [];
      for (const source of sources) {
        const [hl, cs] = await Promise.all([highlightsForSource(source.id), cardsForSource(source.id)]);
        if (hl.length === 0 && cs.length === 0 && !source.thesis) continue;
        out.push({ source, highlights: hl.length, cards: cs.filter((c) => c.status !== "rejected").length, sent: cs.filter((c) => c.status === "exported").length });
      }
      setRows(out);
    })();
  }, []);

  return (
    <div className="library">
      <h1>Library</h1>
      {rows === null ? (
        <p className="hint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="hint">Sources you highlight or generate cards from will appear here.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.source.id}>
              <button type="button" className="source-row" onClick={() => void reader.openSource(r.source.id)}>
                <span className="title">{r.source.title}</span>
                <span className="hint">
                  {[r.source.author, r.source.site].filter(Boolean).join(" · ")}
                  {" — "}
                  {r.highlights} highlights · {r.cards} cards{r.sent ? ` · ${r.sent} sent` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Delete sources in Settings → Privacy.</p>
    </div>
  );
}
