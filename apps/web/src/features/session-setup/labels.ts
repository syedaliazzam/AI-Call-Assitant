/**
 * File: apps/web/src/features/session-setup/labels.ts
 * Purpose: The words shown for stored values: session types, statuses, models and answer
 *          styles, in one place so the dashboard, the wizard and Settings say the same thing.
 * Used by: src/features/dashboard/*, src/features/session-setup/*, src/features/settings/*,
 *          src/features/review/* (lesson scopes, Day 5 Stage 7)
 * Depends on: src/core/storage/types.ts (the values)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1–F3), §5
 */
import {
  SESSION_TYPES,
  type AnswerModel,
  type LessonScope,
  type AnswerStyle,
  type Session,
  type SessionStatus,
  type SessionType,
} from '@/core/storage/types';

/** Where the newest desktop installer is published (docs/user-guide; ADR-0028). */
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/Zainpak123/kite-releases/releases/latest';

/** Display name of each session type. */
export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  interview: 'Interview',
  regular: 'Regular',
  mock: 'Mock',
};

/** The session types as Select / Tabs options, in the dashboard's order. */
export const SESSION_TYPE_OPTIONS = SESSION_TYPES.map((value) => ({
  value,
  label: SESSION_TYPE_LABELS[value],
}));

/** Display name of each status shown on a session card. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  'not-started': 'Ready to start',
  live: 'Live',
  ended: 'Ended',
};

/**
 * The model choices (spec S5; ADR-0095 adds Groq and names each by its speed first). Stored as 'fast', 'smart'
 * and 'groq'; the server maps those to the real model names from its environment and rejects anything else.
 * These are the words a person reads, the same here, in AI preferences and in the overlay.
 */
export const MODEL_OPTIONS: readonly { value: AnswerModel; label: string; tag: string }[] = [
  { value: 'fast', label: 'Fast (Claude Haiku)', tag: 'Recommended' },
  { value: 'smart', label: 'Smart (Claude Sonnet)', tag: 'Deeper, slower' },
  { value: 'groq', label: 'Fastest (Groq)', tag: 'Quickest' },
];

/** One choice of how answers look, as a radio card shows it. */
export interface StyleOption<T extends string> {
  /** The stored value. */
  value: T;
  /** Its name. */
  label: string;
  /** One line about it. */
  description: string;
}

/** Answer format choices (spec S6). */
export const FORMAT_OPTIONS: readonly StyleOption<AnswerStyle['format']>[] = [
  { value: 'paragraph', label: 'Read it out', description: 'An answer you can say word for word.' },
  {
    value: 'headline+bullets',
    label: 'Opening line + bullets',
    description: 'One line to say, then points.',
  },
  { value: 'bullets', label: 'Bullets only', description: 'Short points in your own words.' },
];

/** Answer length choices (spec S6). */
export const LENGTH_OPTIONS: readonly StyleOption<AnswerStyle['length']>[] = [
  { value: 'short', label: 'Short', description: 'Just the essentials.' },
  { value: 'medium', label: 'Balanced', description: 'The answer plus useful context.' },
  { value: 'detailed', label: 'Detailed', description: 'More depth and examples.' },
];

/** Answer tone choices (spec S6; Technical is kept as a third card: the developer's decision). */
export const TONE_OPTIONS: readonly StyleOption<AnswerStyle['tone']>[] = [
  { value: 'simple', label: 'Plain', description: 'Everyday words.' },
  { value: 'professional', label: 'Professional', description: 'Precise, formal wording.' },
  { value: 'technical', label: 'Technical', description: 'Exact terms for a technical audience.' },
];

/**
 * The wizard's last button (spec S5).
 *
 * @param type The session type.
 * @returns "Create interview session", "Create regular session" or "Create mock interview".
 * Called from: SessionWizard.tsx; tests
 */
export function createSessionLabel(type: SessionType): string {
  return {
    interview: 'Create interview session',
    regular: 'Create regular session',
    mock: 'Create mock interview',
  }[type];
}

/**
 * A stored value's name.
 *
 * @param options The choices.
 * @param value   The stored value.
 * @returns Its name, or the value itself when it is not one of the choices.
 * Called from: styleSummary(), AnswerPreferencesDialog.tsx
 */
export function optionLabel<T>(options: readonly { value: T; label: string }[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? String(value);
}

/**
 * The sentence on the Connect screen saying what this session is.
 *
 * @param session The session's type, company, and role or topic.
 * @returns For example "This is an Interview session for Data Analyst at Lantern Freight."
 * Called from: LivePage.tsx; tests
 */
export function sessionSummary(session: Pick<Session, 'type' | 'company' | 'role'>): string {
  const name = `This is a${session.type === 'interview' ? 'n' : ''} ${SESSION_TYPE_LABELS[session.type]} session`;
  return session.type === 'regular'
    ? `${name} about ${session.role} with ${session.company}.`
    : `${name} for ${session.role} at ${session.company}.`;
}

/**
 * One line summing up an answer style.
 *
 * @param style The style.
 * @returns For example "Opening line + bullets · Short · Plain".
 * Called from: the live screen's answer settings; tests
 */
export function styleSummary(style: AnswerStyle): string {
  return [
    optionLabel(FORMAT_OPTIONS, style.format),
    optionLabel(LENGTH_OPTIONS, style.length),
    optionLabel(TONE_OPTIONS, style.tone),
  ].join(' · ');
}

/**
 * The words for a lesson's scope.
 *
 * @param scope 'all' or a session type.
 * @returns "All calls" or, for example, "Mock calls only".
 * Called from: features/review (proposed lessons), features/settings (What Kite has learned)
 */
export function lessonScopeLabel(scope: LessonScope): string {
  return scope === 'all' ? 'All calls' : `${SESSION_TYPE_LABELS[scope]} calls only`;
}

/** The lesson scope choices: all calls first, then each session type. */
export const LESSON_SCOPE_OPTIONS: readonly { value: LessonScope; label: string }[] = [
  { value: 'all', label: lessonScopeLabel('all') },
  ...SESSION_TYPES.map((type) => ({ value: type, label: lessonScopeLabel(type) })),
];
