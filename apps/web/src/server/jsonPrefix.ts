/**
 * File: apps/web/src/server/jsonPrefix.ts
 * Purpose: Reads the complete part of a JSON reply that was cut off at the output-token limit (ADR-0121).
 *          A structured-output reply follows its schema from the first character, so a reply stopped
 *          at `max_tokens` is the start of a valid JSON document. This keeps every value that was
 *          finished before the cut and drops the one being written, so the call notes keep their
 *          complete summary bullets, questions and steps instead of losing everything.
 * Used by: src/server/claude.ts (jsonReply() with keepCutOff)
 * Depends on: nothing (pure)
 * Architecture: docs/decisions/ADR-0121-bugfix-batch-1-cut-offs-groq-voice-image.md §1
 *
 * Rules, so a half-written item never reaches the app:
 * - a string, number, true/false/null cut before its end is dropped (a number at the very end may be
 *   missing digits, so it is dropped too);
 * - an element of an array is kept only when it is complete;
 * - an object or array that is the value of an object member (or the whole reply) keeps its complete
 *   members or elements, so `{"summary":["a","b` reads as `{ summary: ['a'] }`.
 * Never logs: the text is the model's reply.
 */
import 'server-only';

/**
 * Thrown inside the reader when the text ends before the current value does.
 * `partial` holds what the cut value kept (only for objects and arrays).
 */
class CutShort {
  /**
   * @param partial    The complete part of the value that was being read, or undefined.
   * @param hasPartial True when `partial` may be kept (an object or array), false for a scalar.
   */
  constructor(
    readonly partial: unknown,
    readonly hasPartial: boolean,
  ) {}
}

/** Thrown inside the reader when the text is not JSON at all (not just cut short). */
class NotJson extends Error {}

/**
 * Reads the complete part of a JSON document that may be cut short.
 *
 * @param text The reply text: a whole JSON document, or the start of one.
 * @returns The value with only its complete parts, or undefined when nothing complete was read (the
 *          cut came before the first complete member) or the text is not the start of JSON.
 * Called from: jsonReply() in src/server/claude.ts; tests
 */
export function readJsonPrefix(text: string): unknown {
  let at = 0;

  /** Skips spaces and line breaks. */
  const skipSpace = () => {
    while (at < text.length && /\s/.test(text[at]!)) at += 1;
  };

  /**
   * Reads one string, from its opening quote.
   *
   * @returns The string.
   */
  const readString = (): string => {
    const start = at;
    at += 1;
    while (at < text.length) {
      const char = text[at]!;
      if (char === '\\') {
        at += 2;
        continue;
      }
      if (char === '"') {
        at += 1;
        // JSON.parse turns the escapes (\n, é, …) into characters.
        return JSON.parse(text.slice(start, at)) as string;
      }
      at += 1;
    }
    throw new CutShort(undefined, false);
  };

  /**
   * Reads a number or true / false / null.
   *
   * @returns The value.
   */
  const readScalar = (): unknown => {
    const start = at;
    while (at < text.length && /[-+0-9.eEa-z]/.test(text[at]!)) at += 1;
    // At the very end, the number or word may still have had characters to come.
    if (at >= text.length) throw new CutShort(undefined, false);
    try {
      return JSON.parse(text.slice(start, at)) as unknown;
    } catch {
      throw new NotJson();
    }
  };

  /**
   * Reads an array, from its "[".
   *
   * @returns The array.
   */
  const readArray = (): unknown[] => {
    const items: unknown[] = [];
    at += 1;
    skipSpace();
    if (at >= text.length) throw new CutShort(items, true);
    if (text[at] === ']') {
      at += 1;
      return items;
    }
    for (;;) {
      try {
        items.push(readValue());
      } catch (error) {
        // An element cut short is dropped whole: only complete elements are kept.
        if (error instanceof CutShort) throw new CutShort(items, true);
        throw error;
      }
      skipSpace();
      if (at >= text.length) throw new CutShort(items, true);
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text[at] === ']') {
        at += 1;
        return items;
      }
      throw new NotJson();
    }
  };

  /**
   * Reads an object, from its "{".
   *
   * @returns The object.
   */
  const readObject = (): Record<string, unknown> => {
    const members: Record<string, unknown> = {};
    at += 1;
    for (;;) {
      skipSpace();
      if (at >= text.length) throw new CutShort(members, true);
      if (text[at] === '}') {
        at += 1;
        return members;
      }
      if (text[at] !== '"') throw new NotJson();
      let key: string;
      try {
        key = readString();
      } catch (error) {
        if (error instanceof CutShort) throw new CutShort(members, true);
        throw error;
      }
      skipSpace();
      if (at >= text.length) throw new CutShort(members, true);
      if (text[at] !== ':') throw new NotJson();
      at += 1;
      try {
        members[key] = readValue();
      } catch (error) {
        // A member's object or array keeps its complete part; a cut scalar is dropped.
        if (error instanceof CutShort) {
          if (error.hasPartial) members[key] = error.partial;
          throw new CutShort(members, true);
        }
        throw error;
      }
      skipSpace();
      if (at >= text.length) throw new CutShort(members, true);
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text[at] === '}') {
        at += 1;
        return members;
      }
      throw new NotJson();
    }
  };

  /**
   * Reads any value at the current position.
   *
   * @returns The value.
   */
  const readValue = (): unknown => {
    skipSpace();
    if (at >= text.length) throw new CutShort(undefined, false);
    const char = text[at];
    if (char === '{') return readObject();
    if (char === '[') return readArray();
    if (char === '"') return readString();
    return readScalar();
  };

  try {
    return readValue();
  } catch (error) {
    if (error instanceof CutShort) return error.hasPartial ? error.partial : undefined;
    if (error instanceof NotJson || error instanceof SyntaxError) return undefined;
    throw error;
  }
}
