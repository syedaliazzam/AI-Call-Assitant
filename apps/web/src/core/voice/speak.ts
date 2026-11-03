/**
 * File: apps/web/src/core/voice/speak.ts
 * Purpose: Reads Kite's replies aloud with the browser's own speech synthesis (item 8, ADR-0038):
 *          only the readable words (code blocks, Markdown marks and links are left out), in short
 *          sentence-sized pieces, with a stop. Only the Ask Kite page uses it, outside calls: during
 *          a call the speakers' sound would be captured as the other side and could reach the
 *          meeting through the microphone.
 * Used by: src/features/ask-kite/AskKitePage.tsx
 * Depends on: the browser's speechSynthesis (injectable for tests)
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md
 *
 * Text is only handed to the browser's synthesiser; it is never logged.
 */

/**
 * Most characters read aloud from one reply. A long reply (a code walkthrough, a detailed
 * explanation) is for reading; the start is enough to follow by ear, and the rest is on screen.
 */
export const MAX_SPOKEN_CHARS = 1_500;

/**
 * Longest piece handed to the synthesiser at once. Chrome stops a single long utterance after
 * about 15 seconds; sentence-sized pieces queued one after another avoid that.
 */
export const MAX_PIECE_CHARS = 220;

/** What is said in place of a code block. */
const CODE_PLACEHOLDER = 'The code is on screen.';

/**
 * The readable words of a reply: code blocks become a short spoken pointer, inline code keeps its
 * text, links keep their words, and Markdown marks, list marks, the hidden lines and "Note:" labels
 * are removed. Cut to MAX_SPOKEN_CHARS at a sentence end.
 *
 * @param text The reply as written (Markdown).
 * @returns Plain text to read ('' when there is nothing readable).
 * Called from: createSpeaker(); tests
 */
export function readableText(text: string): string {
  let plain = text
    // Fenced code blocks, closed or still open at the end.
    .replace(/```[\s\S]*?(```|$)/g, ` ${CODE_PLACEHOLDER} `)
    // Any hidden line ("[[…]]") that reached the text.
    .replace(/^\s*\[\[[^\n]*$/gm, '')
    // Links: keep the words.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Inline code: keep the text.
    .replace(/`([^`]*)`/g, '$1')
    // Headings, bullets and numbered list marks at line starts.
    .replace(/^\s*(?:#+|[-*•]|\d+[.)])\s+/gm, '')
    // Bold, italics and strike marks.
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/(\.\s*){2,}/g, '. ')
    .trim();
  if (plain.startsWith('. ')) plain = plain.slice(2);
  if (plain.length <= MAX_SPOKEN_CHARS) return plain;
  const cut = plain.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > MAX_SPOKEN_CHARS / 2 ? cut.slice(0, end + 1) : cut;
}

/**
 * Splits readable text into pieces of at most MAX_PIECE_CHARS, at sentence ends where possible,
 * otherwise at spaces.
 *
 * @param text Readable text.
 * @returns The pieces, in order.
 * Called from: createSpeaker(); tests
 */
export function speechPieces(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const pieces: string[] = [];
  let piece = '';
  const push = () => {
    if (piece.trim()) pieces.push(piece.trim());
    piece = '';
  };
  for (const sentence of sentences) {
    if ((piece + sentence).length <= MAX_PIECE_CHARS) {
      piece += sentence;
      continue;
    }
    push();
    let rest = sentence;
    // A sentence longer than a piece is cut at spaces.
    while (rest.length > MAX_PIECE_CHARS) {
      const space = rest.lastIndexOf(' ', MAX_PIECE_CHARS);
      const at = space > 0 ? space : MAX_PIECE_CHARS;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at);
    }
    piece = rest;
  }
  push();
  return pieces;
}

/** The part of SpeechSynthesis the speaker uses (the browser's, or a fake in tests). */
export interface SynthLike {
  /** Queues an utterance. */
  speak: (utterance: SpeechSynthesisUtterance) => void;
  /** Empties the queue and stops speaking. */
  cancel: () => void;
}

/** Options for createSpeaker() (tests replace both). */
export interface SpeakerDeps {
  /** The synthesiser, or null where the browser has none. */
  synth: SynthLike | null;
  /** Creates an utterance for a piece of text. */
  createUtterance: (text: string) => SpeechSynthesisUtterance;
}

/** Reads replies aloud. */
export interface Speaker {
  /** True when this browser can speak. */
  supported: () => boolean;
  /**
   * Reads a reply aloud, replacing anything being read.
   *
   * @param text          The reply (Markdown).
   * @param options.onEnd Called once when the whole reply has been read (not after stop()).
   */
  speak: (text: string, options?: { onEnd?: () => void }) => void;
  /** Stops reading; the pending onEnd is not called. */
  stop: () => void;
  /** True while a reply is being read. */
  speaking: () => boolean;
}

/**
 * The browser's speech objects, or null parts where they are missing (server render, old
 * browsers, some Linux builds).
 *
 * @returns The default dependencies.
 * Called from: createSpeaker() (default argument)
 */
function browserSpeakerDeps(): SpeakerDeps {
  const available =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';
  return {
    synth: available ? window.speechSynthesis : null,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
  };
}

/**
 * Creates a speaker.
 *
 * @param deps The synthesiser and utterance factory (tests pass fakes).
 * @returns The speaker.
 * Called from: src/features/ask-kite/AskKitePage.tsx; tests
 */
export function createSpeaker(deps: SpeakerDeps = browserSpeakerDeps()): Speaker {
  /** Increases with every speak() and stop(), so a cancelled reading's events are ignored. */
  let generation = 0;
  let active = false;

  return {
    supported: () => deps.synth !== null,
    speak(text, options = {}) {
      const synth = deps.synth;
      if (!synth) return;
      generation += 1;
      const mine = generation;
      synth.cancel();
      const pieces = speechPieces(readableText(text));
      if (pieces.length === 0) {
        active = false;
        options.onEnd?.();
        return;
      }
      active = true;
      pieces.forEach((piece, index) => {
        const utterance = deps.createUtterance(piece);
        if (index === pieces.length - 1) {
          // 'error' also ends the reading (for example no voice installed): never leave
          // hands-free waiting for an end that does not come.
          const done = () => {
            if (mine !== generation) return;
            active = false;
            options.onEnd?.();
          };
          utterance.onend = done;
          utterance.onerror = done;
        }
        synth.speak(utterance);
      });
    },
    stop() {
      generation += 1;
      active = false;
      deps.synth?.cancel();
    },
    speaking: () => active,
  };
}
