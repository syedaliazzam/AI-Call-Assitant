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

/** The model choices: Fast = Haiku (live answers), Accurate = Sonnet (stored as 'smart'; architecture F3). */
export const MODEL_OPTIONS: readonly { value: AnswerModel; label: string }[] = [
  { value: 'fast', label: 'Fast (best for live answers)' },
  { value: 'smart', label: 'Accurate (slower, more careful)' },
];

/** Answer format choices. */
export const FORMAT_OPTIONS: readonly { value: AnswerStyle['format']; label: string }[] = [
  { value: 'headline+bullets', label: 'Script + bullets' },
  { value: 'bullets', label: 'Bullets only' },
  { value: 'paragraph', label: 'Script only' },
];

/** Answer length choices. */
export const LENGTH_OPTIONS: readonly { value: AnswerStyle['length']; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Balanced' },
  { value: 'detailed', label: 'Detailed' },
];

/** Answer tone choices. */
export const TONE_OPTIONS: readonly { value: AnswerStyle['tone']; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'professional', label: 'Professional' },
  { value: 'technical', label: 'Technical' },
];

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
 * @returns For example "Script + bullets · Short · Simple".
 * Called from: PreferencesStep.tsx
 */
export function styleSummary(style: AnswerStyle): string {
  const label = <T>(options: readonly { value: T; label: string }[], value: T) =>
    options.find((option) => option.value === value)?.label ?? String(value);
  return [
    label(FORMAT_OPTIONS, style.format),
    label(LENGTH_OPTIONS, style.length),
    label(TONE_OPTIONS, style.tone),
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
