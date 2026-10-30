/**
 * File: apps/web/src/ui/Select.tsx
 * Purpose: A labelled drop-down (native <select>) with an optional hint, styled like Input.
 * Used by: src/features/session-setup/DetailsStep.tsx, PreferencesStep.tsx,
 *          src/features/settings/Settings.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css; square corners)
 */
import { useId } from 'react';

/** One choice in the list. */
export interface SelectOption<T extends string> {
  /** Value reported to onChange. */
  value: T;
  /** Text shown for it. */
  label: string;
}

/** Props for Select. */
export interface SelectProps<T extends string> {
  /** Visible label above the field. */
  label: string;
  /** The choices, in display order. */
  options: readonly SelectOption<T>[];
  /** The selected value. */
  value: T;
  /** Called with the new value. */
  onChange: (value: T) => void;
  /** Optional help text under the field. */
  hint?: string;
  /** True to show it greyed out (for example "Language: English only in v1"). */
  disabled?: boolean;
}

/**
 * A labelled native <select>: keyboard and screen-reader support come from the browser.
 *
 * @param props See SelectProps.
 * @returns The label, the select and the hint.
 * Rendered by: DetailsStep.tsx, PreferencesStep.tsx, Settings.tsx
 */
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
  disabled = false,
}: SelectProps<T>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        // The options are exactly `options`, so the value is always one of T.
        onChange={(event) => onChange(event.target.value as T)}
        className="h-10 border-ui-border border bg-ui-input px-3 text-[15px] text-ui-text placeholder:text-ui-muted transition-colors focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={hintId} className="text-[13px] text-ui-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
