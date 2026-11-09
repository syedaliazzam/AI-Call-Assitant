/**
 * File: apps/web/src/core/transcript/blip.ts
 * Purpose: Tells a "blip" from a real turn (v1.4, ADR-0062): a short sound from the listener while the
 *          other person talks, such as "okay", "um", "mm-hm", "right", or a word the speech model made
 *          from a cough. A blip must not cut the other person's sentence in two: transcript.ts joins their
 *          lines across it, and turns.ts keeps their turn going and shows the blip after it.
 * Used by: src/core/transcript/transcript.ts, turns.ts, src/core/answer/autoAnswer.ts
 * Depends on: src/core/transcript/questionKind.ts (looksGarbled)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2; ADR-0062
 *
 * Pure. Transcript text is never logged.
 */
import { looksGarbled } from './questionKind';

/** A line of at most this many words can be a blip. */
export const BLIP_MAX_WORDS = 2;

/** Words people say to show they are listening, without taking the turn. */
const BACKCHANNELS = new Set([
  'okay',
  'ok',
  'yeah',
  'yes',
  'yep',
  'right',
  'sure',
  'um',
  'umm',
  'uh',
  'uhh',
  'hmm',
  'hm',
  'mm',
  'mhm',
  'mm-hm',
  'mmhm',
  'uh-huh',
  'aha',
  'ah',
  'oh',
  'cool',
  'great',
  'nice',
  'got',
  'it',
  'i',
  'see',
  'exactly',
  'alright',
  'and',
  'a',
  'the',
  'so',
  'sorry',
]);

/** Phrases of more than two words that are still only listening ("I see, okay"). */
const BACKCHANNEL_PHRASES =
  /^(?:(?:okay|ok|yeah|yes|right|sure|i see|got it|mm-?hm|uh-?huh|alright)[\s,.!]*){1,3}$/i;

/**
 * Whether a line is a blip: two words or fewer, a run of listening words, or noise.
 *
 * @param text The line's words.
 * @returns True for a blip.
 * Called from: transcript.ts (joining across it), turns.ts, autoAnswer.ts; tests
 */
export function isBlip(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  const words = trimmed.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [];
  if (words.length === 0) return true;
  if (words.length <= BLIP_MAX_WORDS) return true;
  if (BACKCHANNEL_PHRASES.test(trimmed)) return true;
  if (words.every((word) => BACKCHANNELS.has(word))) return true;
  // Two listening sounds joined into one line, with one stray word heard with them ("um … okay"),
  // are still listening (measured on the synthetic speakers call, ADR-0064).
  // A single letter counts too: "okay" is often heard as "O K".
  const listening = words.filter((word) => BACKCHANNELS.has(word) || word.length === 1).length;
  if (words.length <= 4 && listening >= words.length - 1) return true;
  return looksGarbled(trimmed);
}
