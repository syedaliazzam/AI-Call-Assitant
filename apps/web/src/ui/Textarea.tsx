/**
 * File: apps/web/src/ui/Textarea.tsx
 * Purpose: A labelled multi-line text field with optional hint and error, styled like Input.
 * Used by: src/features/session-setup/DetailsStep.tsx, PreferencesStep.tsx,
 *          src/features/settings/Settings.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
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
      <label htmlFor={fieldId} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'min-h-20 rounded-md border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none',
          error ? 'border-red-500 focus:border-red-600' : 'border-slate-300 focus:border-brand-600',
          className,
        ].join(' ')}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
