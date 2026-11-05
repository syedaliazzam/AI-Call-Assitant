/**
 * File: apps/web/src/ui/Input.tsx
 * Purpose: A labelled text input with optional hint and error message, used by every form (spec §1:
 *          label 15/500, text 15, helper 14 muted, radius 10, 40 px tall).
 * Used by: src/features/auth/LoginForm.tsx, the admin forms, the session wizard
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import { useId, type InputHTMLAttributes } from 'react';

/** Props for Input. Every normal <input> attribute (name, type, value, onChange, …) also works. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** The label. Required so every field is accessible to screen readers. */
  label: string;
  /** True to keep the label for screen readers only (a search box in a toolbar). */
  hideLabel?: boolean;
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
 * Rendered by: CreateUserForm.tsx, LoginForm.tsx, the session wizard
 */
export function Input({
  label,
  hideLabel = false,
  hint,
  error,
  id,
  className = '',
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'text-label text-ui-heading'}>
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'h-10 pointer-coarse:min-h-11 border bg-ui-input px-3 text-base md:text-input text-ui-text placeholder:text-ui-muted transition-colors focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] disabled:cursor-not-allowed disabled:opacity-60',
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
    </div>
  );
}
