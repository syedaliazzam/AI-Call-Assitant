/**
 * File: apps/web/src/ui/Toggle.tsx
 * Purpose: An on/off switch with a label and an optional hint, for settings such as "Save
 *          transcript".
 * Used by: src/features/session-setup/PreferencesStep.tsx, src/features/settings/Settings.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css; square corners)
 */
import { useId } from 'react';

/** Props for Toggle. */
export interface ToggleProps {
  /** Text next to the switch. */
  label: string;
  /** Optional explanation under the label. */
  hint?: string;
  /** True when on. */
  checked: boolean;
  /** Called with the new state when the switch is clicked. */
  onChange: (checked: boolean) => void;
  /** True to show it greyed out and ignore clicks (for example "Beta on Day 6"). */
  disabled?: boolean;
}

/**
 * A switch (role="switch", aria-checked) with its label and hint linked for screen readers.
 *
 * @param props See ToggleProps.
 * @returns The switch with its label.
 * Rendered by: PreferencesStep.tsx, Settings.tsx
 */
export function Toggle({ label, hint, checked, onChange, disabled = false }: ToggleProps) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className={`flex items-start gap-3 ${disabled ? 'opacity-60' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          // Square track and knob (theme: square corners everywhere).
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 border transition-colors duration-150',
          'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
          'disabled:cursor-not-allowed',
          checked ? 'border-ui-primary bg-ui-primary' : 'border-ui-border bg-ui-band',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'absolute top-[1px] size-4 transition-transform duration-150',
            checked ? 'translate-x-4 bg-ui-on-primary' : 'translate-x-[1px] bg-ui-muted',
          ].join(' ')}
        />
      </button>
      <div className="flex flex-col">
        <span id={labelId} className="text-[15px] font-semibold text-ui-heading">
          {label}
        </span>
        {hint && (
          <span id={hintId} className="text-[13px] text-ui-muted">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
