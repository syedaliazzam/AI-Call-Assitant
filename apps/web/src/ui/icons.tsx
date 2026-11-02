/**
 * File: apps/web/src/ui/icons.tsx
 * Purpose: Kite's small line icons, drawn for Kite (no icon library and no other product's marks):
 *          simple strokes that take the current text colour.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md
 */
import type { ReactNode } from 'react';

/** Props for every icon. */
export interface IconProps {
  /** Width and height in px (default 16). */
  size?: number;
}

/**
 * The shared frame of an icon: a 16 × 16 grid, stroked in the current colour, hidden from screen
 * readers (the button around it carries the name).
 *
 * @param props.size     Width and height.
 * @param props.children The strokes.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
function Icon({
  size = 16,
  children,
}: IconProps & {
  /** The strokes. */
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/**
 * Microphone.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function MicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="2" width="4" height="7.5" rx="2" />
      <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14" />
    </Icon>
  );
}

/**
 * Speaker with sound, for the other side's audio.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function SpeakerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 6.5v3H5l3 2.5v-8L5 6.5H2.5ZM10.5 6a3 3 0 0 1 0 4M12.5 4.5a5.5 5.5 0 0 1 0 7" />
    </Icon>
  );
}

/**
 * Four-way arrows: move.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function MoveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.5v13M1.5 8h13M8 1.5 6.3 3.2M8 1.5l1.7 1.7M8 14.5l-1.7-1.7M8 14.5l1.7-1.7M1.5 8l1.7-1.7M1.5 8l1.7 1.7M14.5 8l-1.7-1.7M14.5 8l-1.7 1.7" />
    </Icon>
  );
}

/**
 * Arrows pointing in: collapse.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function CollapseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 2v4.5H2M9.5 2v4.5H14M6.5 14V9.5H2M9.5 14V9.5H14" />
    </Icon>
  );
}

/**
 * Arrows pointing out: expand.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function ExpandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
    </Icon>
  );
}

/**
 * Three dots: menu.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3.2v.01M8 8v.01M8 12.8v.01" strokeWidth="2" />
    </Icon>
  );
}

/**
 * Thumb up.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function ThumbUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 7v6.5H2.5V7H5Zm0 0 2.5-5a1.7 1.7 0 0 1 1.7 1.7V6h3.4a1 1 0 0 1 1 1.2l-1 5.3a1 1 0 0 1-1 1H5" />
    </Icon>
  );
}

/**
 * Thumb down.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function ThumbDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 9V2.5h2.5V9H11Zm0 0-2.5 5a1.7 1.7 0 0 1-1.7-1.7V10H3.4a1 1 0 0 1-1-1.2l1-5.3a1 1 0 0 1 1-1H11" />
    </Icon>
  );
}

/**
 * Two sheets: copy.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 3.5v-1h-8v8h1" />
    </Icon>
  );
}

/**
 * Flag: report.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/CompactView.tsx
 */
export function FlagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 14V2.5h9l-2 3 2 3h-9" />
    </Icon>
  );
}
