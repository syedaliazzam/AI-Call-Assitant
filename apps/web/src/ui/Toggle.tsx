/**
 * File: apps/web/src/ui/Toggle.tsx
 * Purpose: An on/off switch (the accent colour when on, spec §1): on its own for rows that lay out their
 *          own words (Switch), or with a label and an optional hint (Toggle), for settings such as
 *          "Save transcript".
 * Used by: src/features/session-setup/PreferencesStep.tsx, src/features/settings/Settings.tsx,
 *          src/ui/PanelMenu.tsx
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import { useId } from 'react';

/** Props for Switch. */
export interface SwitchProps {
  /** True when on. */
  checked: boolean;
  /** Called with the new state when the switch is clicked. */
  onChange: (checked: boolean) => void;
  /** True to show it greyed out and ignore clicks. */
  disabled?: boolean | undefined;
  /** Its accessible name, when no element labels it. */
  ariaLabel?: string | undefined;
  /** The ids of the elements that label it. */
  labelledBy?: string | undefined;
  /** The ids of the elements that describe it. */
  describedBy?: string | undefined;
}

/**
 * The bare switch (role="switch", aria-checked): a pill track and a white knob.
 *
 * @param props See SwitchProps.
 * @returns The switch.
 * Rendered by: Toggle, src/ui/PanelMenu.tsx, the preference rows
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  labelledBy,
  describedBy,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // The button is the hit area: at least 44 px on touch screens (theme review, UI U1).
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'relative inline-flex h-5 w-9 rounded-full transition-colors duration-(--k-dur)',
          checked ? 'bg-ui-accent-fill' : 'bg-ui-control-strong',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 size-4 rounded-full bg-ui-on-accent transition-transform duration-(--k-dur)',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </span>
    </button>
  );
}

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
  /** True to show it greyed out and ignore clicks. */
  disabled?: boolean;
}

/**
 * A switch with its label and hint linked for screen readers.
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
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        labelledBy={labelId}
        describedBy={hint ? hintId : undefined}
      />
      <div className="flex flex-col">
        <span id={labelId} className="text-label text-ui-heading">
          {label}
        </span>
        {hint && (
          <span id={hintId} className="text-helper text-ui-muted">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
