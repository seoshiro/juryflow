import type { Project } from "../types";
import { slotLabel } from "../io";

export function SlotPicker({
  project,
  value,
  onChange,
  label,
  language,
}: {
  project: Project;
  value: number[];
  onChange: (slots: number[]) => void;
  label: string;
  language: "en" | "ru";
}) {
  return (
    <fieldset className="slot-picker">
      <legend>{label}</legend>
      <div className="slot-pills">
        {Array.from({ length: project.slotCount }, (_, slot) => (
          <button
            key={slot}
            type="button"
            className={
              value.includes(slot) ? "slot-pill available" : "slot-pill"
            }
            aria-pressed={value.includes(slot)}
            aria-label={`${slotLabel(project, slot)} ${value.includes(slot) ? (language === "ru" ? "доступен" : "available") : language === "ru" ? "недоступен" : "unavailable"}`}
            onClick={() =>
              onChange(
                value.includes(slot)
                  ? value.filter((s) => s !== slot)
                  : [...value, slot].sort((a, b) => a - b),
              )
            }
          >
            {slotLabel(project, slot)}
          </button>
        ))}
      </div>
      <span className="field-hint">
        {language === "ru"
          ? "Нажмите время, чтобы изменить доступность. Все времена в UTC."
          : "Select a time to toggle availability. All times in UTC."}
      </span>
    </fieldset>
  );
}
