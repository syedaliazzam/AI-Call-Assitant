/**
 * File: apps/web/src/ui/icons.tsx
 * Purpose: Kite's small line icons, drawn for Kite (no icon library and no other product's marks):
 *          simple strokes that take the current text colour.
 * Used by: src/features/live/CompactView.tsx, src/features/live/ConnectGuide.tsx,
 *          src/features/dashboard/*
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

/**
 * Three dots: more actions.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/dashboard/SessionCard.tsx
 */
export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v.01M8 8v.01M8 13v.01" strokeWidth="2.5" />
    </Icon>
  );
}

/**
 * Rows: the list layout.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/dashboard/Dashboard.tsx
 */
export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </Icon>
  );
}

/**
 * Squares: the grid layout.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/dashboard/Dashboard.tsx
 */
export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" />
      <rect x="9" y="9" width="4.5" height="4.5" />
    </Icon>
  );
}

/**
 * A video camera: a video call.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/ConnectGuide.tsx
 */
export function VideoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.5" y="4" width="9" height="8" rx="1" />
      <path d="M10.5 7l4-2.5v7l-4-2.5" />
    </Icon>
  );
}

/**
 * Two people: a team call.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/ConnectGuide.tsx
 */
export function ChatPeopleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.5" cy="5" r="2.5" />
      <path d="M1.5 13.5c0-2.5 1.8-4 4-4s4 1.5 4 4" />
      <path d="M10.5 3a2.5 2.5 0 0 1 0 4.5M11.5 9.8c1.7.4 3 1.7 3 3.7" />
    </Icon>
  );
}

/**
 * A screen on a stand: a web meeting.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/ConnectGuide.tsx
 */
export function MeetingScreenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1" />
      <path d="M8 11v2.5M5 13.5h6" />
    </Icon>
  );
}

/**
 * A round webcam: a video meeting.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/ConnectGuide.tsx
 */
export function WebcamIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="6.5" r="4.5" />
      <circle cx="8" cy="6.5" r="1.5" />
      <path d="M5 13.5h6" />
    </Icon>
  );
}

/**
 * A phone handset: a phone call.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/ConnectGuide.tsx
 */
export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 2.5h2l1 3-1.5 1a7 7 0 0 0 4.5 4.5l1-1.5 3 1v2a1 1 0 0 1-1 1C7.5 13.5 2.5 8.5 2.5 3.5a1 1 0 0 1 1-1z" />
    </Icon>
  );
}
