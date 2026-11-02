/**
 * File: apps/web/src/ui/Textarea.tsx
 * Purpose: A labelled multi-line text field with optional hint and error, styled like Input.
 * Used by: src/features/session-setup/DetailsStep.tsx, PreferencesStep.tsx,
 *          src/features/settings/Settings.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css)
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
}

/**
 * A multi-line text field with its label, hint and error linked for screen readers.
 *
 * @param props See TextareaProps; `className` styles the <textarea>.
 * @returns The label, field and messages wrapped in a <div>.
 * Rendered by: DetailsStep.tsx, PreferencesStep.tsx, Settings.tsx
 */
export function Textarea({ label, hint, error, id, className = '', ...rest }: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-[13px] font-medium text-ui-muted">
        {label}
      </label>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'min-h-20 py-2.5 leading-relaxed border bg-ui-input px-3 text-base md:text-[15px] text-ui-text placeholder:text-ui-muted transition-colors focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-ui-danger' : 'border-ui-border',
          className,
        ].join(' ')}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-[13px] text-ui-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[13px] text-ui-danger">
          {error}
        </p>
      )}
    </div>
  );
}
