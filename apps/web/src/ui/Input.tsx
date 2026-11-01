/**
 * File: apps/web/src/ui/Input.tsx
 * Purpose: A labelled text input with optional hint and error message, used by every form.
 * Used by: src/features/auth/LoginForm.tsx and the admin forms (Stage 2), later the session wizard
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css; square corners)
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
 * Rendered by: CreateUserForm.tsx, LoginForm.tsx
 */
export function Input({ label, hint, error, id, className = '', ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'h-10 pointer-coarse:min-h-11 border bg-ui-input px-3 text-base md:text-[15px] text-ui-text placeholder:text-ui-muted transition-colors focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] disabled:cursor-not-allowed disabled:opacity-60',
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
