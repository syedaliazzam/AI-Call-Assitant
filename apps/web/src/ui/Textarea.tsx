/**
 * File: apps/web/src/ui/Textarea.tsx
 * Purpose: A labelled multi-line text field with optional hint, error and character counter, styled
 *          like Input.
 * Used by: src/features/session-setup/DetailsStep.tsx, PreferencesStep.tsx,
 *          src/features/settings/Settings.tsx
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import { useId, type TextareaHTMLAttributes } from 'react';

/** Props for Textarea. Every normal <textarea> attribute (value, onChange, rows, …) also works. */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible label above the field. */
  label: string;
  /** Optional help text under the field. */
  hint?: string;
  /** Optional error text; when set, the field is marked invalid and turns red. */
  error?: string;
  /** True to show "used / limit" under the field (needs `maxLength` and a string `value`). */
  counter?: boolean;
}

/**
 * A multi-line text field with its label, hint and error linked for screen readers.
 *
 * @param props See TextareaProps; `className` styles the <textarea>.
 * @returns The label, field and messages wrapped in a <div>.
 * Rendered by: DetailsStep.tsx, PreferencesStep.tsx, Settings.tsx
 */
export function Textarea({
  label,
  hint,
  error,
  counter = false,
  id,
  className = '',
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const used = typeof rest.value === 'string' ? rest.value.length : null;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-label text-ui-heading">
        {label}
      </label>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'min-h-20 py-2.5 leading-relaxed border bg-ui-input px-3 text-base md:text-input text-ui-text placeholder:text-ui-muted transition-colors focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-ui-danger' : 'border-ui-border',
          className,
        ].join(' ')}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-helper text-ui-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-helper text-ui-danger">
          {error}
        </p>
      )}
      {counter && used !== null && rest.maxLength !== undefined && (
        <p className="self-end text-[12px] tabular-nums text-ui-muted">
          {used.toLocaleString('en-US')} / {rest.maxLength.toLocaleString('en-US')}
        </p>
      )}
    </div>
  );
}
