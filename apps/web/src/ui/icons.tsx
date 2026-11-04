/**
 * File: apps/web/src/ui/icons.tsx
 * Purpose: The app's named icons, each one a Lucide icon (spec §0: the closest meaning for each, no
 *          other product's artwork), so a screen says what it means and one place decides the look.
 *          They take the current text colour and are hidden from screen readers: the button around an
 *          icon carries the name. New screens may also import from lucide-react directly.
 * Used by: src/ui/*, src/features/*
 * Depends on: React, lucide-react
 * Architecture: docs/design/paramount-ai-ui-spec.md §0; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import {
  ArrowUpDown,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CodeXml,
  Copy,
  EllipsisVertical,
  FileCheck,
  FileText,
  Flag,
  Globe,
  IdCard,
  Info,
  LayoutGrid,
  List,
  LogOut,
  Maximize2,
  MessageSquare,
  Mic,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  Move,
  PanelLeft,
  Pen,
  Phone,
  Play,
  Plus,
  Presentation,
  RotateCcw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  SunMoon,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Upload,
  User,
  Users,
  Video,
  Volume2,
  Webcam,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Props for every icon. */
export interface IconProps {
  /** Width and height in px (default 16). */
  size?: number;
}

/** The stroke of every icon: a little lighter than Lucide's default, which is heavy at 16 px. */
const STROKE_WIDTH = 1.75;

/**
 * Makes a named icon from a Lucide icon.
 *
 * @param Glyph The Lucide icon.
 * @param fill  True for a solid shape.
 * @returns The icon component.
 * Called from: the constants below
 */
function icon(Glyph: LucideIcon, fill = false) {
  return function Icon({ size = 16 }: IconProps) {
    return (
      <Glyph
        aria-hidden="true"
        size={size}
        strokeWidth={STROKE_WIDTH}
        {...(fill ? { fill: 'currentColor' } : {})}
      />
    );
  };
}

/** Microphone. */
export const MicIcon = icon(Mic);
/** Speaker with sound, for the other side's audio. */
export const SpeakerIcon = icon(Volume2);
/** Four-way arrows: move. */
export const MoveIcon = icon(Move);
/** Arrows pointing in: collapse. */
export const CollapseIcon = icon(Minimize2);
/** Arrows pointing out: expand. */
export const ExpandIcon = icon(Maximize2);
/** Three dots: menu. */
export const MenuIcon = icon(EllipsisVertical);
/** Thumb up. */
export const ThumbUpIcon = icon(ThumbsUp);
/** Thumb down. */
export const ThumbDownIcon = icon(ThumbsDown);
/** Two sheets: copy. */
export const CopyIcon = icon(Copy);
/** Flag: report. */
export const FlagIcon = icon(Flag);
/** Three dots: more actions. */
export const MoreIcon = icon(EllipsisVertical);
/** Rows: the list layout. */
export const ListIcon = icon(List);
/** Squares: the grid layout. */
export const GridIcon = icon(LayoutGrid);
/** A video camera: a video call. */
export const VideoIcon = icon(Video);
/** Two people: a team call. */
export const ChatPeopleIcon = icon(Users);
/** A screen on a stand: a web meeting. */
export const MeetingScreenIcon = icon(Presentation);
/** A round webcam: a video meeting. */
export const WebcamIcon = icon(Webcam);
/** A phone handset: a phone call. */
export const PhoneIcon = icon(Phone);
/** A plus sign. */
export const PlusIcon = icon(Plus);
/** A card with a person on it: a resume. */
export const ResumeIcon = icon(IdCard);
/** A page with lines of text. */
export const DocumentIcon = icon(FileText);
/** A speech bubble. */
export const ChatIcon = icon(MessageSquare);
/** An open book. */
export const BookIcon = icon(BookOpen);
/** A gear: settings. */
export const GearIcon = icon(Settings);
/** A shield. */
export const ShieldIcon = icon(Shield);
/** A code bracket pair, for developer tools. */
export const ToolIcon = icon(CodeXml);
/** A window with a side panel, for the sidebar toggle. */
export const PanelIcon = icon(PanelLeft);
/** An arrow going up: upload. */
export const UploadIcon = icon(Upload);
/** A globe, for the browser or a language. */
export const GlobeIcon = icon(Globe);
/** A computer screen, for the desktop app. */
export const MonitorIcon = icon(Monitor);
/** Sparkles, for the answer model and AI instructions. */
export const SparkIcon = icon(Sparkles);
/** Two sliders, for answer preferences. */
export const SlidersIcon = icon(SlidersHorizontal);
/** A pen, for written instructions. */
export const PenIcon = icon(Pen);
/** A label tag, for key terms. */
export const TagIcon = icon(Tag);
/** A lightning bolt, for auto-answer. */
export const BoltIcon = icon(Zap);
/** A page with a tick, for saving the transcript. */
export const SaveIcon = icon(FileCheck);
/** A play triangle, for the tutorial. */
export const PlayIcon = icon(Play);
/** A cross, for closing a banner. */
export const CloseIcon = icon(X);
/** A minus sign (minimise a window, make something smaller). */
export const MinusIcon = icon(Minus);
/** An arrow going round (reset to the default). */
export const ResetIcon = icon(RotateCcw);
/** A sun (the light theme). */
export const SunIcon = icon(Sun);
/** A crescent moon (the dark theme). */
export const MoonIcon = icon(Moon);
/** A sun and a moon together (the theme follows the system). */
export const SystemThemeIcon = icon(SunMoon);
/** A small i in a circle (more information). */
export const InfoIcon = icon(Info);
/** An arrow pointing out at the top right (opens elsewhere). */
export const OutIcon = icon(ArrowUpRight);
/** Two arrows, up and down (sort). */
export const SortIcon = icon(ArrowUpDown);
/** A magnifying glass (search). */
export const SearchIcon = icon(Search);
/** An arrow leaving (sign out). */
export const SignOutIcon = icon(LogOut);
/** A person's head and shoulders (the account). */
export const PersonIcon = icon(User);
/** A small arrow pointing down (a list opens here). */
export const ChevronDownIcon = icon(ChevronDown);
/** A solid square (stop). */
export const StopIcon = icon(Square, true);
