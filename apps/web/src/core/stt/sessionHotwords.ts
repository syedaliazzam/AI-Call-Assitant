/**
 * File: apps/web/src/core/stt/sessionHotwords.ts
 * Purpose: Builds a session's speech-to-text hotwords: the names and terms the recognizer
 *          should prefer during this call. Sources, in priority order: the session's key terms
 *          (typed by the user), the company, the role or topic, for Interview sessions a
 *          built-in technical vocabulary (Day 6 Stage 4c), then names and acronyms that repeat
 *          in the session's documents (at most MAX_DOCUMENT_TERMS of them). ADR-0076: the same sources
 *          as Deepgram keyterms (buildKeyterms). Batch D (P1-F, ADR-0079): the keyterms also hold the
 *          user's first name and the contact's name, and single capitalised words that repeat across
 *          runs (extractSingleWordTerms), up to 100 terms; the on-device hotwords are unchanged.
 * Used by: src/features/live/LiveSession.tsx (before the engine starts), src/features/dev/SttTest.tsx
 *          ("Use session"), src/features/review/SessionReview.tsx (the listened-for words),
 *          app/(app)/live/[id]/page.tsx and app/(app)/sessions/[id]/page.tsx (firstNameOf)
 * Depends on: src/core/stt/hotwords.ts (cleaning to the model's alphabet), src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0020 (hotwords,
 *               real-call result); day-03-sessions.md Stage 4
 *
 * Why: names and technical terms are Kite's main transcription errors (ADR-0020, Day 2 real
 * call), and hotwords fixed the test names exactly in a clean test (Day 1). Session text is the
 * user's content: this module never logs it.
 */
import { parseKeyTerms } from '@kite/shared';
import type { Session, StoredDocument } from '../storage/types';
import { formatHotwords, MAX_HOTWORD_SCORE, type Hotword } from './hotwords';
import { spokenVariants } from './spokenNumbers';

/**
 * Boost for the user's key terms and the company: the strongest, because the user named them
 * on purpose (the Day 1–2 tests used 2 for names).
 */
export const KEY_TERM_SCORE = 2;

/** Boost for the role or topic: often ordinary words ("Account review"), so a milder boost. */
export const ROLE_SCORE = 1.5;

/** Boost for terms found in documents: guessed, so the milder boost too. */
export const DOCUMENT_TERM_SCORE = 1.5;

/** Boost for the Interview technical vocabulary: common words, so the milder boost too. */
export const TECH_TERM_SCORE = 1.5;

/**
 * Most document terms used (the most mentioned first), so a long document cannot crowd out the
 * built-in vocabulary within MAX_HOTWORDS (Day 6 Stage 4c).
 */
export const MAX_DOCUMENT_TERMS = 40;

/**
 * Technical words that technical interviews use and the recognizer often mishears (Day 6
 * Stage 4c). Added for Interview sessions only, after the user's own terms.
 */
export const INTERVIEW_TECH_TERMS: readonly string[] = [
  'RAG',
  'LLM',
  'retrieval',
  'embeddings',
  'vector database',
  'async',
  'Python',
  'fine-tuning',
  'evaluation',
  'hallucination',
  'latency',
  'API',
  'prompt',
];

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
 * Builds a session's hotwords, in priority order (key terms, company, role/topic, the
 * Interview technical vocabulary, document terms), without duplicates (the first,
 * highest-priority entry wins) and capped at MAX_HOTWORDS.
 *
 * @param session   The session (its key terms, company, role and type are used; without a
 *                  type, no built-in vocabulary is added).
 * @param documents The session's documents.
 * @returns The hotwords for the recognizer.
 * Called from: LiveSession.tsx (before the engine starts), SttTest.tsx ("Use session"); tests
 */
export function buildHotwords(
  session: Pick<Session, 'company' | 'role' | 'preferences'> & Partial<Pick<Session, 'type'>>,
  documents: readonly Pick<StoredDocument, 'text'>[],
): Hotword[] {
  const result: Hotword[] = [];
  const seen = new Set<string>();
  /**
   * Adds a phrase unless it is unusable, already present, or the list is full. A term that
   * contains a digit is added as its spoken-word variants instead (ADR-0027): the model's alphabet
   * has no digits, so "BM25" is added as "BM TWENTY FIVE" (and "BM TWO FIVE"), not as "BM". Each
   * variant counts towards the cap, so the user's own key terms (added first) keep their place.
   *
   * @param text  The phrase as written.
   * @param score Its boost.
   */
  const add = (text: string, score: number) => {
    const variants = spokenVariants(text);
    for (const candidate of variants.length > 0 ? variants : [text]) {
      const phrase = cleanPhrase(candidate);
      if (!phrase || seen.has(phrase) || result.length >= MAX_HOTWORDS) continue;
      seen.add(phrase);
      result.push({ phrase, score });
    }
  };

  // 1. Key terms: split on commas, semicolons and new lines (shared rule, v1.0.1). A " :score"
  //    the user typed is respected. The raw text (digits and all) goes to add(), so a term like
  //    "BM25" becomes spoken-word hotwords instead of losing its number to the model's letter-only
  //    alphabet (ADR-0027).
  for (const rawLine of parseKeyTerms(session.preferences.keyTerms)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const match = /\s:\s*(\S+)\s*$/.exec(` ${line}`);
    const score = match ? Number(match[1]) : KEY_TERM_SCORE;
    // An invalid score is skipped, as formatHotwords() does.
    if (match && (!Number.isFinite(score) || score <= 0 || score > MAX_HOTWORD_SCORE)) continue;
    add(match ? ` ${line}`.slice(0, match.index).trim() : line, score);
  }
  // 2. Company, then 3. role or topic.
  add(session.company, KEY_TERM_SCORE);
  add(session.role, ROLE_SCORE);
  // 4. Interview sessions: the built-in technical vocabulary.
  if (session.type === 'interview') {
    for (const term of INTERVIEW_TECH_TERMS) add(term, TECH_TERM_SCORE);
  }
  // 5. Names and acronyms that repeat in the documents, the most mentioned first.
  const documentTerms = extractDocumentTerms(documents.map((document) => document.text));
  for (const term of documentTerms.slice(0, MAX_DOCUMENT_TERMS)) {
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

/**
 * ADR-0076: the most keyterms sent to Deepgram. Batch D (P1-F, ADR-0079): raised from 50 to Deepgram's
 * documented limit of 100, because the 14 Nov call's list was full of the built-in vocabulary while names
 * in the CV were left out.
 */
export const MAX_KEYTERMS = 100;

/**
 * Batch D (P1-F): the most characters all keyterms may have together. Deepgram counts keyterms in tokens
 * (a few hundred at most per request); 1,500 characters stays well inside that, so a session with long
 * terms loses its last terms instead of failing the handshake (which would drop every keyterm).
 */
export const MAX_KEYTERM_CHARS = 1_500;

/** Batch D (P1-F): the most single capitalised words from the documents (after the multi-word terms). */
export const MAX_SINGLE_WORD_TERMS = 30;

/**
 * Batch D (P1-F): capitalised single words a CV or a brief uses for headings and roles, not names: never
 * single-word keyterms (they stay usable inside a longer name). Upper case, as compared.
 */
const SINGLE_WORD_STOP = new Set(
  (
    'ENGINEER ENGINEERING DEVELOPER DEVELOPMENT SENIOR JUNIOR LEAD PRINCIPAL STAFF MANAGER HEAD ' +
    'SOFTWARE EXPERIENCE EDUCATION SKILLS SKILL PROJECTS PROJECT WORK TEAM ROLE RESPONSIBILITIES ' +
    'BUILT LED DEVELOPED DESIGNED IMPLEMENTED CREATED MANAGED WORKED USED REDUCED IMPROVED ' +
    'UNIVERSITY COLLEGE SCHOOL BACHELOR MASTER DEGREE CERTIFICATE CERTIFICATION PRESENT CURRENT ' +
    'CONTACT EMAIL PHONE PROFILE OBJECTIVE ABOUT OVERVIEW INTRODUCTION BACKGROUND REFERENCES'
  ).split(' '),
);

/**
 * Batch D (P1-F, ADR-0079): single capitalised words that repeat in the documents, counted across runs.
 * extractDocumentTerms() counts exact runs, so "Freshdesk" alone, "Zendesk Freshdesk" and "Freshdesk" at a
 * sentence start were three different runs and none reached two mentions (the 14 Nov call missed Freshdesk
 * and Toptal this way). Here each capitalised word counts wherever it appears; it needs MIN_DOCUMENT_MENTIONS
 * in all and at least one mention inside a sentence (a word only ever seen at a sentence start is grammar).
 * Acronyms (extractDocumentTerms keeps them), common words and heading words are left out.
 *
 * @param texts The documents' texts.
 * @returns The words as first written ("Freshdesk"), most mentioned first (ties alphabetical).
 * Called from: buildKeyterms(); tests
 */
export function extractSingleWordTerms(texts: readonly string[]): string[] {
  const counts = new Map<string, { word: string; mentions: number; inside: number }>();
  for (const text of texts) {
    for (const sentence of text.split(/[.!?:\n]+/)) {
      sentence
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token, index) => {
          const word = token.replace(/^[("“'[]+|[)"”'\],;]+$/g, '').replace(/['’]s$/, '');
          if (!CAPITALISED.test(word) || ACRONYM.test(word) || word.length < 3) return;
          const key = word.toUpperCase().replace(/[^A-Z]/g, '');
          if (key.length < 3 || COMMON_WORDS.has(key) || SINGLE_WORD_STOP.has(key)) return;
          const entry = counts.get(key) ?? { word, mentions: 0, inside: 0 };
          entry.mentions += 1;
          if (index > 0) entry.inside += 1;
          counts.set(key, entry);
        });
    }
  }
  return [...counts.values()]
    .filter((entry) => entry.mentions >= MIN_DOCUMENT_MENTIONS && entry.inside > 0)
    .sort((a, b) => b.mentions - a.mentions || a.word.localeCompare(b.word))
    .map((entry) => entry.word);
}

/**
 * Batch D (P1-F): the first name in an account's display name ("Sam Rivera" → "Sam"), for the keyterms.
 *
 * @param name The account's name, if known.
 * @returns The first word with at least two letters, or '' when there is none.
 * Called from: LiveSession.tsx, SessionReview.tsx (through their props); tests
 */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return (first.match(/\p{L}/gu) ?? []).length >= 2 ? first : '';
}

/** Batch D (P1-F): people on the call whose names the keyterms add. Never logged. */
export interface KeytermPeople {
  /** The signed-in user's first name (firstNameOf() of the account name), or ''. */
  accountFirstName?: string;
}

/**
 * ADR-0076: a document term (upper case, the on-device model's alphabet) written back the way people
 * write it: an acronym stays upper case, other words get a capital first letter ("NORTHWIND LOGISTICS" →
 * "Northwind Logistics").
 *
 * @param phrase A DocumentTerm phrase.
 * @returns The phrase for Deepgram.
 * Called from: buildKeyterms()
 */
function readableTerm(phrase: string): string {
  return phrase
    .split(' ')
    .map((word) =>
      ACRONYM.test(word) && word.length <= 4 ? word : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

/**
 * ADR-0076: the session's keyterms for Deepgram (both channels get the same list), as people write them:
 * no scores, digits kept ("BM25"), original case, no duplicates (ignoring case), at most MAX_PHRASE_WORDS
 * words and MAX_PHRASE_CHARS characters each, and at most MAX_KEYTERMS (and MAX_KEYTERM_CHARS) in all.
 * Session text: never logged.
 *
 * Priority (Batch D, P1-F, ADR-0079): 1. the session's Key terms field (the user's own list always comes
 * first); 2. the signed-in user's first name; 3. the session's contact name (the 14 Nov call heard the
 * user's name as "zone": no name was ever a keyterm); 4. company; 5. role or topic; 6. the Interview
 * vocabulary; 7. names and acronyms that repeat in the documents; 8. single capitalised words that repeat
 * in the documents (extractSingleWordTerms: "Freshdesk", "Toptal").
 *
 * @param session   The session (its key terms, contact name, company, role and type are used).
 * @param documents The session's documents.
 * @param people    Batch D: the signed-in user's first name (optional; '' or absent adds nothing).
 * @returns The keyterms, highest priority first.
 * Called from: LiveSession.tsx (sent to Deepgram), SessionReview.tsx ("Words Paramount AI listens for"); tests
 */
export function buildKeyterms(
  session: Pick<Session, 'company' | 'role' | 'preferences'> &
    Partial<Pick<Session, 'type' | 'contactName'>>,
  documents: readonly Pick<StoredDocument, 'text'>[],
  people: KeytermPeople = {},
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  /**
   * Adds a term unless it is unusable, already present, or the list is full.
   *
   * @param raw The term as written.
   */
  const add = (raw: string | undefined) => {
    const term = (raw ?? '').replace(/\s+/g, ' ').trim();
    const key = term.toLowerCase();
    if (term === '' || result.length >= MAX_KEYTERMS || seen.has(key)) return;
    if (term.length > MAX_PHRASE_CHARS || term.split(' ').length > MAX_PHRASE_WORDS) return;
    // At least two letters: a lone number or initial is not worth biasing towards.
    if ((term.match(/\p{L}/gu) ?? []).length < 2) return;
    if (chars + term.length > MAX_KEYTERM_CHARS) return;
    seen.add(key);
    chars += term.length;
    result.push(term);
  };
  for (const rawLine of parseKeyTerms(session.preferences.keyTerms)) {
    // A " :score" typed for the on-device engine means nothing to Deepgram: dropped.
    add(rawLine.replace(/\s:\s*\S+\s*$/, ''));
  }
  add(people.accountFirstName);
  add(session.contactName);
  add(session.company);
  add(session.role);
  if (session.type === 'interview') for (const term of INTERVIEW_TECH_TERMS) add(term);
  const texts = documents.map((document) => document.text);
  const documentTerms = extractDocumentTerms(texts);
  for (const term of documentTerms.slice(0, MAX_DOCUMENT_TERMS)) add(readableTerm(term.phrase));
  for (const word of extractSingleWordTerms(texts).slice(0, MAX_SINGLE_WORD_TERMS)) add(word);
  return result;
}

/**
 * ADR-0093: adds the other person's name, accepted during the call ("Rename Them to Sarah?"), to the
 * call's keyterms, so Deepgram spells it the same way from then on. It goes first (a name heard on the
 * call matters more than a document term); the list keeps MAX_KEYTERMS and MAX_KEYTERM_CHARS by dropping
 * its last terms. A name already listed (ignoring case), too long, or empty changes nothing.
 *
 * @param terms The call's keyterms (buildKeyterms()).
 * @param name  The other person's name.
 * @returns The keyterms with the name (the same array when nothing changes).
 * Called from: LivePage.tsx (after a rename during the call); tests
 */
export function withNameKeyterm(terms: readonly string[], name: string): readonly string[] {
  const term = name.replace(/\s+/g, ' ').trim();
  if (
    term === '' ||
    term.length > MAX_PHRASE_CHARS ||
    term.split(' ').length > MAX_PHRASE_WORDS ||
    terms.some((existing) => existing.toLowerCase() === term.toLowerCase())
  ) {
    return terms;
  }
  const result = [term, ...terms];
  let chars = result.reduce((total, one) => total + one.length, 0);
  while (result.length > MAX_KEYTERMS || chars > MAX_KEYTERM_CHARS) {
    chars -= result.pop()!.length;
  }
  return result;
}
