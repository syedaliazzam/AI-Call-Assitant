/**
 * File: apps/web/src/core/stt/hotwords.ts
 * Purpose: Turns a hotwords list typed by a person (one phrase per line, optional boost score)
 *          into the text sherpa-onnx expects (its hotwords "buffer"). Hotwords make the
 *          recognizer prefer the listed phrases (names of people, companies and products) during
 *          modified_beam_search decoding.
 * Used by: src/core/stt/sttClient.ts (startMicTranscription option), src/features/dev/SttTest.tsx
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0020
 *
 * On the Day 1 test page the list is typed by hand. Day 3: the list is built from the session's
 * details and documents (participant and company names, product terms).
 *
 * Why phrases are upper-cased and cleaned: the English models' vocabulary has only upper-case
 * letters and the apostrophe. sherpa-onnx silently ignores a phrase it cannot encode, so
 * "Bluefin Route" would have no effect without this step (measured on Day 1).
 */

/** Boost used for a line without its own score (sherpa-onnx's own default is 1.5). */
export const DEFAULT_HOTWORD_SCORE = 1.5;

/** Highest boost accepted; higher values make the recognizer hear the phrase everywhere. */
export const MAX_HOTWORD_SCORE = 10;

/** One hotword phrase, ready for sherpa-onnx. */
export interface Hotword {
  /** Phrase in the model's alphabet (upper-case words separated by one space). */
  phrase: string;
  /** Boost score for this phrase. */
  score: number;
}

/** The result of formatHotwords(). */
export interface FormattedHotwords {
  /** The accepted phrases. */
  hotwords: Hotword[];
  /** Text for the recognizer config's hotwordsBuf: one "PHRASE :score" per line ('' for none). */
  buffer: string;
  /** Line numbers (1-based) that were skipped: no letters left, or a bad score. */
  skippedLines: number[];
}

/** A score at the end of a line: " :2", " :2.5" (sherpa-onnx's own syntax). */
const SCORE_SUFFIX = /\s:\s*(\S+)\s*$/;

/**
 * Parses a hotwords list.
 * Each non-empty line is one phrase, optionally followed by " :score". Phrases are upper-cased;
 * hyphens and other separators become spaces; anything that is not a letter A–Z or an
 * apostrophe is dropped. Numbers must be written as words ("nine thirty").
 *
 * @param text         The list as typed (one phrase per line).
 * @param defaultScore Boost for lines without their own score.
 * @returns The accepted phrases, the recognizer buffer, and the skipped line numbers.
 * Called from: SttTest.tsx (preview and Start), sttClient.ts
 */
export function formatHotwords(
  text: string,
  defaultScore: number = DEFAULT_HOTWORD_SCORE,
): FormattedHotwords {
  const hotwords: Hotword[] = [];
  const skippedLines: number[] = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    let line = rawLine.trim();
    if (line === '') return;
    let score = defaultScore;
    const match = SCORE_SUFFIX.exec(` ${line}`);
    if (match) {
      score = Number(match[1]);
      line = ` ${line}`.slice(0, match.index).trim();
      if (!Number.isFinite(score) || score <= 0 || score > MAX_HOTWORD_SCORE) {
        skippedLines.push(index + 1);
        return;
      }
    }
    const phrase = line
      .toUpperCase()
      .replace(/[^A-Z']+/g, ' ')
      .replace(/(^|\s)'+|'+(?=\s|$)/g, ' ') // quotes around words, not apostrophes inside them
      .trim()
      .replace(/\s+/g, ' ');
    if (phrase === '') {
      skippedLines.push(index + 1);
      return;
    }
    hotwords.push({ phrase, score });
  });
  const buffer = hotwords.map((hotword) => `${hotword.phrase} :${hotword.score}`).join('\n');
  return { hotwords, buffer: buffer === '' ? '' : `${buffer}\n`, skippedLines };
}
