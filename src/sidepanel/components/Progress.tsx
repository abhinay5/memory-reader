import { useEffect, useState } from "react";
import { STAGE_LABELS } from "../../ai/pipeline";
import type { Busy } from "../useReader";

/** Explicit stage list — no fake percentages. */
export function Progress({ busy, onCancel }: { busy: Busy; onCancel: () => void }) {
  const currentIndex = busy.current ? busy.stages.indexOf(busy.current) : -1;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
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
      <p className="hint" aria-hidden="true">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · Claude is reading carefully; this usually takes under a minute.
      </p>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
