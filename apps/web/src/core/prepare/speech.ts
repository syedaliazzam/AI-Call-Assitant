/**
 * File: apps/web/src/core/prepare/speech.ts
 * Purpose: Reads a mock interview question aloud with the browser's own speech synthesis: no paid
 *          voice, and nothing leaves the device for it. Some computers have no voice installed,
 *          and some browsers never report the end of speech, so it always finishes: on the end, on
 *          an error, or after a time limit that fits the text's length.
 * Used by: src/features/prepare/MockInterview.tsx
 * Depends on: nothing (the browser's speechSynthesis)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0029
 */

/** The browser objects speak() uses (tests replace them). */
export interface SpeechDeps {
  /** The browser's speech synthesis, or null where there is none. */
  synthesis: Pick<SpeechSynthesis, 'speak' | 'cancel'> | null;
  /** Makes an utterance. */
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  /** Sets a timer. */
  setTimer: (callback: () => void, ms: number) => () => void;
}

/** The longest a question can take to read, per character, in ms (a slow voice). */
const MS_PER_CHARACTER = 120;

/** Time allowed for a voice to start, in ms. */
const START_ALLOWANCE_MS = 3_000;

/**
 * The browser's objects.
 *
 * @returns The defaults for speak().
 * Called from: speak()
 */
function browserDeps(): SpeechDeps {
  return {
    synthesis: typeof speechSynthesis === 'undefined' ? null : speechSynthesis,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  };
}

/**
 * Reads text aloud.
 *
 * @param text The text.
 * @param deps Browser objects (tests replace them).
 * @returns Resolves when it has finished: true when spoken, false when no voice could read it (the
 *          text is on screen anyway). Never rejects.
 * Called from: MockInterview.tsx; tests
 */
export function speak(text: string, deps: SpeechDeps = browserDeps()): Promise<boolean> {
  return new Promise((resolve) => {
    const { synthesis } = deps;
    if (!synthesis) {
      resolve(false);
      return;
    }
    let finished = false;
    let clearTimer = () => {};
    const finish = (spoken: boolean) => {
      if (finished) return;
      finished = true;
      clearTimer();
      resolve(spoken);
    };
    const utterance = deps.createUtterance(text);
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    clearTimer = deps.setTimer(
      () => {
        synthesis.cancel();
        finish(false);
      },
      START_ALLOWANCE_MS + text.length * MS_PER_CHARACTER,
    );
    try {
      synthesis.speak(utterance);
    } catch {
      finish(false);
    }
  });
}

/**
 * Stops anything being read.
 *
 * @param deps Browser objects (tests replace them).
 * @returns Nothing.
 * Called from: MockInterview.tsx (leaving the page, ending early); tests
 */
export function stopSpeaking(deps: SpeechDeps = browserDeps()): void {
  deps.synthesis?.cancel();
}
