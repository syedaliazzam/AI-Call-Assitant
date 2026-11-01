/**
 * File: apps/web/src/features/live/speakers.ts
 * Purpose: How each speaker looks in the live screens: display name and colours, so "You" and
 *          "Them" are told apart the same way in the meters and the transcript.
 * Used by: src/features/live/AudioMeter.tsx, src/features/live/TranscriptStrip.tsx,
 *          src/features/live/ConnectPanel.tsx
 * Depends on: src/core/transcript/transcript.ts (Speaker type)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session)
 */
import type { Speaker } from '@/core/transcript/transcript';

/** Display name and Tailwind classes for one speaker. */
export interface SpeakerStyle {
  /** "You" or "Them". */
  name: string;
  /** Classes for the speaker's label text. */
  label: string;
  /** Classes for the speaker's meter bar. */
  bar: string;
}

/** You = brand indigo, Them = emerald (distinct for common colour-vision types too). */
export const SPEAKER_STYLE: Record<Speaker, SpeakerStyle> = {
  // Theme §6: You in cyan, Them in blue-300 on the dark call screens.
  you: { name: 'You', label: 'text-ui-you', bar: 'bg-ui-you' },
  them: { name: 'Them', label: 'text-ui-them', bar: 'bg-ui-them' },
};
