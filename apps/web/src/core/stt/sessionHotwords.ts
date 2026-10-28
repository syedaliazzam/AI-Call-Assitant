/**
 * File: apps/web/src/core/stt/sessionHotwords.ts
 * Purpose: Builds a session's speech-to-text hotwords: the names and terms the recognizer
 *          should prefer during this call. Sources, in priority order: the session's key terms
 *          (typed by the user), the company, the role or topic, then names and acronyms that
 *          repeat in the session's documents.
 * Used by: src/features/live/LiveSession.tsx (before the engine starts), src/features/dev/SttTest.tsx
 *          ("Use session")
 * Depends on: src/core/stt/hotwords.ts (cleaning to the model's alphabet), src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0020 (hotwords,
 *               real-call result); day-03-sessions.md Stage 4
 *
 * Why: names and technical terms are Kite's main transcription errors (ADR-0020, Day 2 real
 * call), and hotwords fixed the test names exactly in a clean test (Day 1). Session text is the
 * user's content: this module never logs it.
 */
import type { Session, StoredDocument } from '../storage/types';
import { formatHotwords, type Hotword } from './hotwords';

/**
 * Boost for the user's key terms and the company: the strongest, because the user named them
 * on purpose (the Day 1–2 tests used 2 for names).
 */
export const KEY_TERM_SCORE = 2;

/** Boost for the role or topic: often ordinary words ("Account review"), so a milder boost. */
export const ROLE_SCORE = 1.5;

/** Boost for terms found in documents: guessed, so the milder boost too. */
export const DOCUMENT_TERM_SCORE = 1.5;

/**
 * Most phrases sent to the recognizer. Each hotword adds work to every decoding step and makes
 * a false match a little more likely; 100 covers a call's real names with room to spare.
 */
export const MAX_HOTWORDS = 100;

/**
 * Longest phrase, in words. Names are short; a long line in the key terms is usually a
 * sentence, which as a hotword would only distort the transcript.
 */
export const MAX_PHRASE_WORDS = 5;

/** Longest phrase, in characters (same reason as MAX_PHRASE_WORDS). */
export const MAX_PHRASE_CHARS = 50;

/** How many times a document term must appear to count (one mention is often noise). */
export const MIN_DOCUMENT_MENTIONS = 2;

/**
 * Capitalised words that are not names: sentence starters, pronouns, titles, days, months and
 * document words. Upper case, as compared after cleaning. A document phrase made only of these is
 * dropped, and they are trimmed from the ends of longer phrases ("The Northwind" → "NORTHWIND").
 */
const COMMON_WORDS = new Set(
  (
    'A AN THE AND OR BUT IF THEN SO OF IN ON AT TO FOR BY WITH FROM AS IS ARE WAS WERE BE ' +
    'I WE YOU HE SHE IT THEY ME US HIM HER THEM MY OUR YOUR HIS ITS THEIR THIS THAT THESE THOSE ' +
    'WHAT WHEN WHERE WHO WHY HOW WHICH ALL ANY EACH EVERY SOME NO NOT YES OK OKAY PLEASE THANK ' +
    'THANKS DEAR HI HELLO REGARDS BEST MR MRS MS DR INC LTD LLC CO CORP PAGE TOTAL NEXT NEW ' +
    'NOTE NOTES SUMMARY DATE TIME NAME TITLE TABLE FIGURE SECTION CHAPTER APPENDIX ' +
    'MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY SUNDAY JANUARY FEBRUARY MARCH APRIL ' +
    'MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER AM PM TV ID'
  ).split(' '),
);

/** A term found in the documents, with how often it appears. */
export interface DocumentTerm {
  /** The phrase, cleaned to the model's alphabet (upper case). */
  phrase: string;
  /** Number of mentions across all documents. */
  mentions: number;
}

/**
 * Cleans one phrase to the model's alphabet (upper case A–Z and apostrophes) the way the
 * recognizer needs it, and drops it when it is too long or has fewer than 2 letters.
 *
 * @param text The phrase as written.
 * @returns The cleaned phrase, or null when it cannot be used.
 * Called from: buildHotwords(), extractDocumentTerms(); tests
 */
export function cleanPhrase(text: string): string | null {
  // formatHotwords() is the one place that knows the model's alphabet. A trailing " :score"
  // typed by the user is handled there too; the score itself is applied by the caller.
  const phrase = formatHotwords(text).hotwords[0]?.phrase ?? null;
  if (!phrase || phrase.replace(/[^A-Z]/g, '').length < 2) return null;
  if (phrase.length > MAX_PHRASE_CHARS || phrase.split(' ').length > MAX_PHRASE_WORDS) return null;
  return phrase;
}

/**
 * Removes common words from both ends of a phrase ("THE NORTHWIND TEAM" keeps "NORTHWIND TEAM").
 *
 * @param phrase A cleaned phrase.
 * @returns The trimmed phrase, or '' when only common words were left.
 */
function trimCommonWords(phrase: string): string {
  const words = phrase.split(' ');
  while (words.length > 0 && COMMON_WORDS.has(words[0]!)) words.shift();
  while (words.length > 0 && COMMON_WORDS.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

/** A word that starts with a capital letter (letters, apostrophes and hyphens after it). */
const CAPITALISED = /^[A-Z][A-Za-z'’-]*$/;

/** An acronym: 2–6 capital letters, optionally a plural "s" (for example "CRM", "SLAs"). */
const ACRONYM = /^[A-Z]{2,6}s?$/;

/**
 * Cleans a run of words into a document-term phrase: possessive "'s" removed, cleaned to the
 * model's alphabet, common words trimmed from both ends.
 *
 * @param words The words as written.
 * @returns The phrase, or null when nothing usable is left.
 */
function termPhrase(words: readonly string[]): string | null {
  const cleaned = cleanPhrase(words.join(' ').replace(/['’]s\b/g, ''));
  const phrase = cleaned ? trimCommonWords(cleaned) : '';
  return phrase !== '' && cleanPhrase(phrase) !== null ? phrase : null;
}

/**
 * Finds names and acronyms that repeat in the documents. Names are runs of capitalised words
 * ("Northwind Logistics"); a comma or semicolon ends a run. A term needs MIN_DOCUMENT_MENTIONS.
 *
 * Every sentence starts with a capital letter, so a run at the start of a sentence is ambiguous
 * ("Contact Northwind Logistics…" is a verb plus a name). Such runs are decided after all
 * documents are read: if the run without its first word also appears mid-sentence, that shorter
 * name gets the mention; otherwise a run of two or more words counts as it is ("Northwind
 * Logistics agreed."), and a lone first word is ignored (it is just grammar).
 *
 * @param texts The documents' texts.
 * @returns The terms, most mentioned first (ties in alphabetical order, so the list is the same every time).
 * Called from: buildHotwords(); tests
 */
export function extractDocumentTerms(texts: readonly string[]): DocumentTerm[] {
  const mentions = new Map<string, number>();
  /** Runs that started a sentence, decided at the end (see above). */
  const sentenceStarts: string[][] = [];
  /**
   * Counts one mention of a phrase.
   *
   * @param phrase A cleaned phrase, or null to count nothing.
   */
  const add = (phrase: string | null) => {
    if (phrase) mentions.set(phrase, (mentions.get(phrase) ?? 0) + 1);
  };

  for (const text of texts) {
    // Sentences: split at full stops, question and exclamation marks, colons and line breaks.
    for (const sentence of text.split(/[.!?:\n]+/)) {
      const tokens = sentence.split(/\s+/).filter(Boolean);
      let run: string[] = [];
      let runStartsSentence = false;
      /** Ends the current run of capitalised words: counts it now, or keeps it for later. */
      const flush = () => {
        if (run.length > 0) {
          if (runStartsSentence) sentenceStarts.push(run);
          else add(termPhrase(run));
        }
        run = [];
      };
      tokens.forEach((token, index) => {
        // Brackets and quotes around a word are not part of it; a comma or semicolon after it
        // ends the run ("Later, Acme Robotics" is not one name).
        const word = token.replace(/^[("“'[]+|[)"”'\],;]+$/g, '');
        const endsRun = /[,;]["”')\]]*$/.test(token);
        if (ACRONYM.test(word)) {
          flush();
          add(termPhrase([word.replace(/s$/, '')]));
        } else if (CAPITALISED.test(word)) {
          if (run.length === 0) runStartsSentence = index === 0;
          run.push(word);
        } else {
          flush();
        }
        if (endsRun) flush();
      });
      flush();
    }
  }

  for (const run of sentenceStarts) {
    const tail = run.length > 1 ? termPhrase(run.slice(1)) : null;
    if (tail && mentions.has(tail)) add(tail);
    else if (run.length > 1) add(termPhrase(run));
  }

  return [...mentions.entries()]
    .filter(([, n]) => n >= MIN_DOCUMENT_MENTIONS)
    .map(([phrase, n]) => ({ phrase, mentions: n }))
    .sort((a, b) => b.mentions - a.mentions || a.phrase.localeCompare(b.phrase));
}

/**
 * Builds a session's hotwords, in priority order (key terms, company, role/topic, document
 * terms), without duplicates (the first, highest-priority entry wins) and capped at
 * MAX_HOTWORDS.
 *
 * @param session   The session (its key terms, company and role are used).
 * @param documents The session's documents.
 * @returns The hotwords for the recognizer.
 * Called from: LiveSession.tsx (before the engine starts), SttTest.tsx ("Use session"); tests
 */
export function buildHotwords(
  session: Pick<Session, 'company' | 'role' | 'preferences'>,
  documents: readonly Pick<StoredDocument, 'text'>[],
): Hotword[] {
  const result: Hotword[] = [];
  const seen = new Set<string>();
  /**
   * Adds a phrase unless it is unusable, already present, or the list is full.
   *
   * @param text  The phrase as written.
   * @param score Its boost.
   */
  const add = (text: string, score: number) => {
    const phrase = cleanPhrase(text);
    if (!phrase || seen.has(phrase) || result.length >= MAX_HOTWORDS) return;
    seen.add(phrase);
    result.push({ phrase, score });
  };

  // 1. Key terms: one per line. A " :score" the user typed is respected.
  for (const hotword of formatHotwords(session.preferences.keyTerms, KEY_TERM_SCORE).hotwords) {
    add(hotword.phrase, hotword.score);
  }
  // 2. Company, then 3. role or topic.
  add(session.company, KEY_TERM_SCORE);
  add(session.role, ROLE_SCORE);
  // 4. Names and acronyms that repeat in the documents.
  for (const term of extractDocumentTerms(documents.map((document) => document.text))) {
    add(term.phrase, DOCUMENT_TERM_SCORE);
  }
  return result;
}

/**
 * Writes hotwords in the text format the speech engine takes: one "PHRASE :score" per line.
 *
 * @param hotwords The hotwords.
 * @returns The text ('' for none).
 * Called from: LiveSession.tsx, SttTest.tsx ("Use session"); tests
 */
export function hotwordsText(hotwords: readonly Hotword[]): string {
  return hotwords.map((hotword) => `${hotword.phrase} :${hotword.score}`).join('\n');
}
