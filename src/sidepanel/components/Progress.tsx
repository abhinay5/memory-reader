import { STAGE_LABELS } from "../../ai/pipeline";
import type { Busy } from "../useReader";

/** Explicit stage list — no fake percentages. */
export function Progress({ busy, onCancel }: { busy: Busy; onCancel: () => void }) {
  const currentIndex = busy.current ? busy.stages.indexOf(busy.current) : -1;
  return (
    <section className="progress" aria-live="polite" aria-busy="true">
      <h2>{busy.label}</h2>
      {busy.stages.length > 0 && (
        <ol>
          {busy.stages.map((s, i) => (
            <li key={s} className={i < currentIndex ? "done" : i === currentIndex ? "active" : ""}>
              <span className="dot" aria-hidden="true" />
              {STAGE_LABELS[s]}
              {i < currentIndex && <span className="sr-only"> (done)</span>}
              {i === currentIndex && <span className="sr-only"> (in progress)</span>}
            </li>
          ))}
        </ol>
      )}
      {busy.stages.length === 0 && <p className="hint">Working…</p>}
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
