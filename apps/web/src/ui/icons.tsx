/**
 * File: apps/web/src/ui/icons.tsx
 * Purpose: Kite's small line icons, drawn for Kite (no icon library and no other product's marks):
 *          simple strokes that take the current text colour.
 * Used by: src/features/live/CompactView.tsx, src/features/live/ConnectGuide.tsx,
 *          src/features/dashboard/*, src/features/session-setup/*, src/features/library/UploadBox.tsx,
 *          src/ui/Sidebar.tsx
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
      <path d="M14 2 9.5 6.5M9.5 2.5v4h4M2 14l4.5-4.5M6.5 13.5v-4h-4" />
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
      <path d="M9.5 6.5 14 2M10 2h4v4M6.5 9.5 2 14M6 14H2v-4" />
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

/**
 * A plus sign.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

/**
 * A page with a person on it.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function ResumeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2h8v12H4z" />
      <circle cx="8" cy="6" r="1.5" />
      <path d="M6 11c0-1.2.9-2 2-2s2 .8 2 2" />
    </Icon>
  );
}

/**
 * A page with lines of text.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3M6 8h4M6 11h4" />
    </Icon>
  );
}

/**
 * A speech bubble.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 3.5h11v8H7l-3 2v-2H2.5z" />
    </Icon>
  );
}

/**
 * An open book.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 4c-1.5-1-3.5-1-5.5-1v9.5c2 0 4 0 5.5 1 1.5-1 3.5-1 5.5-1V3C11.5 3 9.5 3 8 4zM8 4v9.5" />
    </Icon>
  );
}

/**
 * A settings dial: a circle with sliders.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function GearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </Icon>
  );
}

/**
 * A shield.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" />
    </Icon>
  );
}

/**
 * A code bracket pair, for developer tools.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function ToolIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 4L2.5 8 6 12M10 4l3.5 4-3.5 4" />
    </Icon>
  );
}

/**
 * A window with a side panel, for the sidebar toggle.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function PanelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 3h11v10h-11zM6 3v10" />
    </Icon>
  );
}

/**
 * An arrow going up into a tray.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 10V3M5 5.5L8 3l3 2.5M3 10v3h10v-3" />
    </Icon>
  );
}

/**
 * A globe, for the browser or a language.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.8 1.6 2.5 3.5 2.5 5.5S9.8 11.9 8 13.500C6.2 11.9 5.5 10 5.5 8S6.2 4.1 8 2.500z" />
    </Icon>
  );
}

/**
 * A computer screen, for the desktop app.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function MonitorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 3h12v8H2zM6 14h4M8 11v3" />
    </Icon>
  );
}

/**
 * A small star, for the answer model.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2l1.5 4.500L14 8l-4.5 1.500L8 14l-1.5-4.500L2 8l4.5-1.500z" />
    </Icon>
  );
}

/**
 * Two sliders, for answer preferences.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6" />
      <circle cx="10" cy="5" r="1.5" />
      <circle cx="6" cy="11" r="1.5" />
    </Icon>
  );
}

/**
 * A pen, for written instructions.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function PenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 13l.8-3L10.5 3.300l2.2 2.200L6 12.200z" />
    </Icon>
  );
}

/**
 * A label tag, for key terms.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function TagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 2.500h5l6 6-5 5-6-6z" />
      <circle cx="5.5" cy="5.5" r=".8" />
    </Icon>
  );
}

/**
 * A lightning bolt, for auto-answer.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function BoltIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 1.500L3.5 9H8l-1 5.500L12.5 7H8z" />
    </Icon>
  );
}

/**
 * A page with a tick, for saving the transcript.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function SaveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2h8v12H4z" />
      <path d="M6 8.500l1.5 1.500L10 7" />
    </Icon>
  );
}

/**
 * A play triangle, for the tutorial.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3l8 5-8 5z" />
    </Icon>
  );
}

/**
 * A cross, for closing a banner.
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/Sidebar.tsx, src/features/session-setup/*, src/features/library/UploadBox.tsx
 */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

/**
 * A minus sign (minimise a window, make something smaller).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/home/HomePanel.tsx, src/ui/PanelMenu.tsx
 */
export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8h9" />
    </Icon>
  );
}

/**
 * An arrow going round (reset to the default).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/PanelMenu.tsx
 */
export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8a5 5 0 1 0 1.6-3.7L3 5.8" />
      <path d="M3 2.8v3h3" />
    </Icon>
  );
}

/**
 * A sun (the light theme).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/PanelMenu.tsx
 */
export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />
    </Icon>
  );
}

/**
 * A crescent moon (the dark theme).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/PanelMenu.tsx
 */
export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.2 9.8A5.6 5.6 0 0 1 6.2 2.8a5.6 5.6 0 1 0 7 7Z" />
    </Icon>
  );
}

/**
 * A circle half filled in (the theme follows the system).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/PanelMenu.tsx
 */
export function SystemThemeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11Z" fill="currentColor" />
    </Icon>
  );
}

/**
 * A small i in a circle (more information).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/PanelMenu.tsx
 */
export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.4v3.2M8 5.2v.2" />
    </Icon>
  );
}

/**
 * An arrow pointing out at the top right (opens elsewhere).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/home/HomePanel.tsx, src/ui/PanelMenu.tsx
 */
export function OutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 11l6-6M6 5h5v5" />
    </Icon>
  );
}

/**
 * Two arrows, up and down (sort).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/home/HomePanel.tsx
 */
export function SortIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 13V3M5 3 2.8 5.2M5 3l2.2 2.2M11 3v10M11 13l-2.2-2.2M11 13l2.2-2.2" />
    </Icon>
  );
}

/**
 * A magnifying glass (search).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/home/HomePanel.tsx
 */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3.3 3.3" />
    </Icon>
  );
}

/**
 * A door with an arrow leaving it (sign out).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/home/HomeMenu.tsx
 */
export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 2.8H3.5v10.4h3M10 5.2 13 8l-3 2.8M13 8H6.5" />
    </Icon>
  );
}

/**
 * A person's head and shoulders (the account).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/ui/PanelMenu.tsx
 */
export function PersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="5.4" r="2.6" />
      <path d="M3 13.5c.5-2.6 2.5-4 5-4s4.500 1.400 5 4" />
    </Icon>
  );
}

/**
 * A small arrow pointing down (a list opens here).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/overlay/*, src/ui/PanelMenu.tsx
 */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 6.5 3.500 3.500 3.500-3.500" />
    </Icon>
  );
}

/**
 * A solid square (stop).
 *
 * @param props See IconProps.
 * @returns The icon.
 * Rendered by: src/features/live/overlay/AnswerCard.tsx
 */
export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.500" y="4.500" width="7" height="7" rx="1" fill="currentColor" />
    </Icon>
  );
}
