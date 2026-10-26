/**
 * File: apps/web/src/ui/Input.tsx
 * Purpose: A labelled text input with optional hint and error message, used by every form.
 * Used by: src/features/auth/LoginForm.tsx and the admin forms (Stage 2), later the session wizard
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 */
import { useId, type InputHTMLAttributes } from 'react';

/** Props for Input. Every normal <input> attribute (name, type, value, onChange, …) also works. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label above the field. Required so every field is accessible to screen readers. */
  label: string;
  /** Optional help text under the field, for example "At least 10 characters". */
  hint?: string;
  /** Optional error text under the field; when set, the field is marked invalid and turns red. */
  error?: string;
}

/**
 * A text field with its label, hint and error wired together for accessibility
 * (the hint and error are linked with aria-describedby).
 *
 * @param props See InputProps; `id` is generated when not given; `className` styles the <input>.
 * @returns The label, input and messages wrapped in a <div>.
 */
export function Input({ label, hint, error, id, className = '', ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'h-10 rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400',
          'focus:outline-2 focus:outline-offset-1 focus:outline-brand-600',
          'disabled:cursor-not-allowed disabled:bg-slate-100',
          error ? 'border-red-500' : 'border-slate-300',
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
