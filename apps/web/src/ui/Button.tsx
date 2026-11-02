/**
 * File: apps/web/src/ui/Button.tsx
 * Purpose: The one button style used across Kite, with a few visual variants and sizes.
 * Used by: src/features/dashboard/Dashboard.tsx (and every later feature); src/ui/LinkButton.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css)
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
   * - primary: the main action on a screen (solid dark on light pages, white on dark); one per view.
   * - secondary: other actions (white with a thin border; outlined on dark surfaces).
   * - ghost: low-emphasis actions such as "Cancel" (text only).
   * - danger: destructive actions such as "Delete" (outlined in the danger colour).
   */
  variant?: ButtonVariant;
  /** Size. Default 'md'; 'sm' is for table rows and toolbars. */
  size?: ButtonSize;
}

/** Tailwind classes for each variant. */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // The solid button; the tokens switch on dark surfaces. One per view.
  primary: 'bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover',
  // White with a thin border; outlined on dark surfaces (the --ui-secondary tokens switch).
  secondary:
    'border border-ui-secondary-border bg-ui-secondary-bg text-ui-secondary hover:border-ui-secondary-hover-border hover:bg-ui-secondary-hover-bg',
  // Text only, for low-emphasis actions such as Cancel.
  ghost: 'text-ui-text hover:bg-ui-hover',
  // Outlined in the danger colour; destructive actions only.
  danger: 'border border-ui-danger text-ui-danger hover:bg-ui-hover',
};

/** Tailwind classes for each size. */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-[15px]',
};

/**
 * The classes of a button of the given look. Shared with LinkButton, so a link that looks like
 * a button is exactly the same size and colour.
 *
 * @param variant   The visual style.
 * @param size      The size.
 * @param className Extra classes, appended.
 * @returns The class list.
 * Called from: Button, LinkButton.tsx
 */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
): string {
  return [
    // k-btn marks every button-looking control (the UI screenshot test checks their size).
    'k-btn inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-150',
    // Touch screens: at least 44 px tall (theme review, UI U1).
    'pointer-coarse:min-h-11',
    'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ].join(' ');
}

/**
 * A styled <button>.
 * Defaults to type="button" so a button inside a form never submits it by accident;
 * pass type="submit" explicitly for submit buttons.
 *
 * @param props See ButtonProps; `className` is appended to the built-in classes.
 * @returns The button element.
 * Rendered by: the feature components (admin, auth, dashboard, dev, live)
 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  ...rest
}: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}
