/**
 * File: apps/web/src/features/session-setup/labels.ts
 * Purpose: The words shown for stored values: session types, statuses, models and answer
 *          styles, in one place so the dashboard, the wizard and Settings say the same thing.
 * Used by: src/features/dashboard/*, src/features/session-setup/*, src/features/settings/*
 * Depends on: src/core/storage/types.ts (the values)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1–F3), §5
 */
import {
  SESSION_TYPES,
  type AnswerModel,
  type AnswerStyle,
  type SessionStatus,
  type SessionType,
} from '@/core/storage/types';

/** Display name of each session type. */
export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  interview: 'Interview',
  sales: 'Sales',
  support: 'Support',
  internal: 'Internal',
};

/** The session types as Select / Tabs options, in the dashboard's order. */
export const SESSION_TYPE_OPTIONS = SESSION_TYPES.map((value) => ({
  value,
  label: SESSION_TYPE_LABELS[value],
}));

/** Display name of each status shown on a session card. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  'not-started': 'Not started',
  live: 'Live',
  ended: 'Ended',
};

/** The model choices: Fast = Haiku (live answers), Smart = Sonnet (architecture F3). */
export const MODEL_OPTIONS: readonly { value: AnswerModel; label: string }[] = [
  { value: 'fast', label: 'Fast (best for live answers)' },
  { value: 'smart', label: 'Smart (slower, more careful)' },
];

/** Answer format choices. */
export const FORMAT_OPTIONS: readonly { value: AnswerStyle['format']; label: string }[] = [
  { value: 'headline+bullets', label: 'Headline and bullets' },
  { value: 'paragraph', label: 'Short paragraph' },
];

/** Answer length choices. */
export const LENGTH_OPTIONS: readonly { value: AnswerStyle['length']; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
];

/** Answer tone choices. */
export const TONE_OPTIONS: readonly { value: AnswerStyle['tone']; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
];
