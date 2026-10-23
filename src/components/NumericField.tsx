import { useEffect, useId, useState } from "react";

/** Parse a committed edit; an incomplete keystroke must never change stored data. */
export function committedInteger(
  draft: string,
  min: number,
  max: number,
): number | null {
  if (!/^\d+$/.test(draft.trim())) return null;
  const value = Number(draft);
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

export function NumericField({
  value,
  min,
  max,
  label,
  language,
  onCommit,
  onDraftChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  language: "en" | "ru";
  onCommit: (value: number) => void;
  onDraftChange: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  function commit() {
    const parsed = committedInteger(draft, min, max);
    setInvalid(parsed === null);
    if (parsed !== null) {
      setDraft(String(parsed));
      if (parsed !== value) onCommit(parsed);
    }
  }
  return (
    <>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        aria-label={label}
        value={draft}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          onDraftChange();
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(value));
            setInvalid(false);
          }
        }}
      />
      {invalid && (
        <span id={errorId} className="numeric-error" role="alert">
          {language === "ru"
            ? `Введите целое число от ${min} до ${max}. Сохранено прежнее значение ${value}.`
            : `Enter a whole number from ${min} to ${max}. The saved value is still ${value}.`}
        </span>
      )}
    </>
  );
}
