/**
 * File: apps/web/src/ui/Toggle.tsx
 * Purpose: An on/off switch with a label and an optional hint, for settings such as "Save
 *          transcript".
 * Used by: src/features/session-setup/PreferencesStep.tsx, src/features/settings/Settings.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
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
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
          'disabled:cursor-not-allowed',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
      <div className="flex flex-col">
        <span id={labelId} className="text-sm font-medium text-slate-800">
          {label}
        </span>
        {hint && (
          <span id={hintId} className="text-xs text-slate-500">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
