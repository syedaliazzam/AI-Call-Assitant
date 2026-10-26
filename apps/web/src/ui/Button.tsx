/**
 * File: apps/web/src/ui/Button.tsx
 * Purpose: The one button style used across Kite, with a few visual variants and sizes.
 * Used by: src/features/dashboard/Dashboard.tsx (and every later feature)
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 */
import type { ButtonHTMLAttributes } from 'react';

/** Visual style of a button. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Height and padding of a button. */
export type ButtonSize = 'sm' | 'md';

/** Props for Button. Every normal <button> attribute (onClick, disabled, type, …) also works. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual style. Default 'primary'.
   * - primary: the main action on a screen (filled).
   * - secondary: other actions (outlined).
   * - ghost: low-emphasis actions such as "Cancel" (text only).
   * - danger: destructive actions such as "Delete" (red).
   */
  variant?: ButtonVariant;
  /** Size. Default 'md'; 'sm' is for table rows and toolbars. */
  size?: ButtonSize;
}

/** Tailwind classes for each variant. */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

/** Tailwind classes for each size. */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

/**
 * A styled <button>.
 * Defaults to type="button" so a button inside a form never submits it by accident;
 * pass type="submit" explicitly for submit buttons.
 *
 * @param props See ButtonProps; `className` is appended to the built-in classes.
 * @returns The button element.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      {...rest}
    />
  );
}
