import { STUDY_MODE_GUIDANCE } from "../../ai/prompts";
import type { StudyMode } from "../../types";

const MODES: StudyMode[] = ["remember", "understand", "master"];

export function ModeSelector({ value, onChange, disabled }: { value: StudyMode; onChange: (m: StudyMode) => void; disabled?: boolean }) {
  return (
    <fieldset className="mode" disabled={disabled}>
      <legend>Study mode</legend>
      <div className="segmented" role="radiogroup" aria-label="Study mode">
        {MODES.map((m) => (
          <label key={m} className={value === m ? "on" : ""}>
            <input type="radio" name="study-mode" value={m} checked={value === m} onChange={() => onChange(m)} />
            {STUDY_MODE_GUIDANCE[m].label}
          </label>
        ))}
      </div>
      <p className="hint">{STUDY_MODE_GUIDANCE[value].description}</p>
    </fieldset>
  );
}
