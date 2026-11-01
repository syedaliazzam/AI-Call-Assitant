/**
 * File: apps/web/src/ui/ProgressBar.tsx
 * Purpose: A thin horizontal progress bar (for example the speech-model download).
 * Used by: src/features/live/ConnectPanel.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css; square corners)
 */

/** Props for ProgressBar. */
export interface ProgressBarProps {
  /** Progress, 0…1. */
  value: number;
  /** What the bar measures, for screen readers (for example "Speech model download"). */
  label: string;
}

/**
 * A progress bar with an accessible label and value (role="progressbar").
 *
 * @param props See ProgressBarProps.
 * @returns The bar.
 * Rendered by: ConnectPanel.tsx (speech-model download)
 */
export function ProgressBar({ value, label }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="h-2 w-full overflow-hidden bg-ui-band"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="h-full bg-ui-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}
