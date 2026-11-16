/**
 * File: apps/web/src/core/transcript/theirName.ts
 * Purpose: The other person's label on a call (ADR-0093). Their real name when the call or the session
 *          has one, else "Interviewer" for interview sessions (and mock interviews) and "Them" for other
 *          calls. Also finds a name in the way people introduce themselves ("I'm Sarah…", "this is Sarah
 *          from…", "my name is…"), so the call can offer "Rename Them to Sarah?"; it never renames by
 *          itself, and it skips phrases that only look like names ("I'm sure", "I'm good", "I'm from…").
 * Used by: src/core/transcript/turns.ts (speakerNames), src/features/live (the live page, the overlay's
 *          rename prompt), src/features/review (the session page), src/core/drive (the call's PDFs)
 * Depends on: @kite/shared (cleanPersonName)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0093
 *
 * Transcript text passes through here in memory only; it is never logged.
 */
import { cleanPersonName } from '@kite/shared';
import type { Session, StoredCall } from '../storage/types';

/** The other person's label when no name is known, on calls that are not interviews. */
export const THEM_LABEL = 'Them';

/** The other person's label when no name is known, on interviews and mock interviews. */
export const INTERVIEWER_LABEL = 'Interviewer';

/**
 * The label to show when no name is known.
 *
 * @param type The session's type ('interview', 'mock' or 'regular'; undefined for a harness).
 * @returns "Interviewer" for interviews and mock interviews, else "Them".
 * Called from: theirLabel(); tests
 */
export function fallbackTheirLabel(type: Session['type'] | undefined): string {
  return type === 'interview' || type === 'mock' ? INTERVIEWER_LABEL : THEM_LABEL;
}

/**
 * The other person's real name for one call: the call's own name (set by a rename for this call), else
 * the session's contact name. Cleaned; '' when neither has one.
 *
 * @param session The session (its contactName), if known.
 * @param call    The call (its themName), if known.
 * @returns The name, or ''.
 * Called from: theirLabel(); the live page (the AI's speaker label); tests
 */
export function theirName(
  session: Pick<Session, 'contactName'> | null | undefined,
  call?: Pick<StoredCall, 'themName'> | null,
): string {
  return cleanPersonName(call?.themName) || cleanPersonName(session?.contactName);
}

/**
 * The other person's label for one call: their name, or the session type's fallback.
 *
 * @param session The session (its type and contactName), if known.
 * @param call    The call (its themName), if known.
 * @returns For example "Sarah", "Interviewer" or "Them".
 * Called from: speakerNames() in turns.ts; the live page; the review page; tests
 */
export function theirLabel(
  session: (Pick<Session, 'contactName'> & Partial<Pick<Session, 'type'>>) | null | undefined,
  call?: Pick<StoredCall, 'themName'> | null,
): string {
  return theirName(session, call) || fallbackTheirLabel(session?.type);
}

/**
 * Words that follow "I'm", "this is" or "my name is" without being a name. Lower case; a candidate is
 * compared in lower case. Covers states and feelings ("I'm good"), place and role phrases ("I'm from…",
 * "I'm the…"), verbs in -ing that are listed separately below, nationalities and languages that people
 * often say with a capital, and fillers.
 */
const NOT_NAMES = new Set([
  // Feelings, states, answers.
  'sure',
  'good',
  'great',
  'fine',
  'okay',
  'ok',
  'well',
  'glad',
  'happy',
  'sorry',
  'afraid',
  'aware',
  'ready',
  'done',
  'here',
  'there',
  'back',
  'new',
  'busy',
  'free',
  'late',
  'early',
  'right',
  'wrong',
  'excited',
  'interested',
  'curious',
  'thrilled',
  'pleased',
  'delighted',
  'confident',
  'not',
  'no',
  'yes',
  'yeah',
  'yep',
  'nope',
  'also',
  'just',
  'still',
  'really',
  'very',
  'so',
  'quite',
  'pretty',
  'actually',
  'currently',
  'always',
  'never',
  'all',
  'now',
  'only',
  'even',
  'too',
  'more',
  'less',
  'able',
  'unable',
  'available',
  'responsible',
  'based',
  'located',
  'open',
  'sorry',
  'fine',
  'cool',
  'alright',
  'awesome',
  'perfect',
  'exactly',
  'absolutely',
  'definitely',
  'probably',
  'maybe',
  'kind',
  'sort',
  'like',
  'about',
  'trying',
  'used',
  'supposed',
  'gonna',
  'gotta',
  'wondering',
  'hoping',
  'thinking',
  'guessing',
  'assuming',
  'curious',
  'confused',
  'lost',
  'stuck',
  'tired',
  'well',
  // Places, roles, determiners, prepositions, pronouns.
  'from',
  'in',
  'on',
  'at',
  'with',
  'for',
  'of',
  'to',
  'by',
  'into',
  'over',
  'out',
  'off',
  'up',
  'down',
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'your',
  'our',
  'my',
  'his',
  'her',
  'their',
  'one',
  'someone',
  'somebody',
  'everyone',
  'nobody',
  'what',
  'who',
  'where',
  'how',
  'why',
  'when',
  'which',
  'if',
  'as',
  'and',
  'or',
  'but',
  'is',
  'was',
  'be',
  'i',
  'me',
  'you',
  'we',
  'they',
  'he',
  'she',
  'them',
  'us',
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'sir',
  'madam',
  'part',
  'head',
  'lead',
  'manager',
  'director',
  'recruiter',
  'engineer',
  'developer',
  'founder',
  'ceo',
  'cto',
  'hiring',
  'interviewer',
  'candidate',
  'team',
  'company',
  'calling',
  'speaking',
  'joining',
  // Greetings and call words said with a capital.
  'hi',
  'hello',
  'hey',
  'thanks',
  'thank',
  'welcome',
  'please',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'today',
  'tomorrow',
  'yesterday',
  'zoom',
  'teams',
  'google',
  'meet',
  'slack',
  'skype',
  // Nationalities and languages.
  'english',
  'american',
  'british',
  'canadian',
  'australian',
  'indian',
  'pakistani',
  'german',
  'french',
  'spanish',
  'italian',
  'dutch',
  'chinese',
  'japanese',
  'korean',
  'arabic',
  'russian',
  'european',
  'asian',
  'african',
  'irish',
  'scottish',
  'welsh',
  'mexican',
  'brazilian',
  'polish',
]);

/** Honorifics that may come before a name ("I'm Dr. Patel"): skipped, the name after them is taken. */
const HONORIFICS = /^(?:mr|mrs|ms|miss|dr|prof)\.?$/i;

/** One word that may be part of a name: a capital letter first, then letters, apostrophes or hyphens. */
const NAME_WORD = /^\p{Lu}[\p{L}\p{M}'’-]*$/u;

/** Words after a name that make "this is Sarah …" an introduction on their own. */
const INTRODUCTION_WORDS = /^\s+(?:from|here|speaking|calling|with)\b/i;

/** The end of a sentence or a pause after a name ("Hi, this is Sarah."). */
const NAME_END = /^(?:$|\s*[,.!?;:])/;

/** A greeting before "this is" in the same line ("Hi, this is Sarah.", "Hello there, it's Sam."). */
const GREETING = /\b(?:hi|hello|hey|morning|afternoon|evening)\b/i;

/**
 * Takes a name from the words that follow an introduction phrase: one or two capitalised words that are
 * not listed in NOT_NAMES (an honorific before them is skipped).
 *
 * @param rest     The text after the phrase.
 * @param greeted  For "this is" / "it's" (needEnd): whether a greeting came before the phrase.
 * @param needEnd  True for "this is" / "it's", which start many ordinary sentences ("this is Python"):
 *                 the name must be followed by from/here/speaking/calling/with, or, after a greeting,
 *                 by the end of the sentence or a pause.
 * @returns The name, or null.
 * Called from: detectIntroducedName()
 */
function nameAt(rest: string, greeted: boolean, needEnd: boolean): string | null {
  // Up to three words with any punctuation still on them, and where each ends in `rest`.
  const words: { raw: string; end: number }[] = [];
  const wordPattern = /\S+/gu;
  for (
    let found = wordPattern.exec(rest);
    found && words.length < 3;
    found = wordPattern.exec(rest)
  ) {
    words.push({ raw: found[0], end: found.index + found[0].length });
  }
  // "I'm Dr. Patel": the honorific is not part of the label.
  if (words[0] && HONORIFICS.test(words[0].raw)) words.shift();
  /**
   * A word without the punctuation after it ("Sarah," → "Sarah").
   *
   * @param raw The word as written.
   * @returns The word alone.
   */
  const bare = (raw: string) => raw.replace(/[,.!?;:]+$/u, '');
  /**
   * Whether the word ends a sentence or a phrase, so no second name word may follow it.
   *
   * @param raw The word as written.
   * @returns True when punctuation follows it.
   */
  const stops = (raw: string) => /[,.!?;:]$/u.test(raw);
  const isName = (raw: string | undefined): raw is string => {
    if (!raw) return false;
    const token = bare(raw);
    return (
      NAME_WORD.test(token) &&
      token.length >= 2 &&
      !NOT_NAMES.has(token.toLowerCase()) &&
      // "Sarah's" (a possessive) is not an introduction: "this is Sarah's team".
      !/['’]s$/u.test(token)
    );
  };
  const first = words[0];
  if (!first || !isName(first.raw)) return null;
  const second = !stops(first.raw) && isName(words[1]?.raw) ? words[1] : undefined;
  const last = second ?? first;
  const name = second ? `${bare(first.raw)} ${bare(second.raw)}` : bare(first.raw);
  if (needEnd) {
    // What follows the name in the original text (its own punctuation included).
    const after = rest.slice(last.end - (last.raw.length - bare(last.raw).length));
    if (!INTRODUCTION_WORDS.test(after) && !(greeted && NAME_END.test(after))) return null;
  }
  return name;
}

/** The introduction phrases, each with whether the name must be followed by an introduction's end. */
const INTRODUCTIONS: readonly { pattern: RegExp; needEnd: boolean }[] = [
  { pattern: /\bmy name(?:'s|’s| is)\s+/giu, needEnd: false },
  { pattern: /\b(?:i'm|i’m|i am)\s+/giu, needEnd: false },
  { pattern: /\b(?:this is|it's|it’s|it is)\s+/giu, needEnd: true },
];

/**
 * Finds the name a person gives when they introduce themselves, in one of their transcript lines.
 * The name must be written with a capital letter (cloud transcription capitalises names), so plain
 * words such as "I'm sure" or "I'm from London" are never taken; listed words are skipped even with a
 * capital ("I'm Good.").
 *
 * @param text    One line the other person said.
 * @param exclude Names that are not theirs (the user's own name, the company): never offered.
 * @returns The name ("Sarah" or "Sarah Chen"), cleaned, or null.
 * Called from: the live page (each new "Them" line); tests
 */
export function detectIntroducedName(text: string, exclude: readonly string[] = []): string | null {
  const excluded = new Set(
    exclude.flatMap((value) => value.toLowerCase().split(/\s+/)).filter((word) => word.length >= 2),
  );
  for (const { pattern, needEnd } of INTRODUCTIONS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const greeted = GREETING.test(text.slice(Math.max(0, match.index - 40), match.index));
      const name = nameAt(text.slice(match.index + match[0].length), greeted, needEnd);
      if (!name) continue;
      if (name.split(' ').some((word) => excluded.has(word.toLowerCase()))) continue;
      const clean = cleanPersonName(name);
      if (clean) return clean;
    }
  }
  return null;
}

/**
 * Replaces one label with another wherever it stands as a whole word (case as written), so "Them asked
 * about pricing" becomes "Sarah asked about pricing" but "Themes" and "them" stay.
 *
 * @param text The text.
 * @param from The label the text was written with.
 * @param to   The label to show.
 * @returns The text with the label replaced.
 * Called from: relabelNotes()
 */
function replaceLabel(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`, 'gu'), to);
}

/**
 * The notes as they should read with the call's current label (ADR-0093): the label their lines carried
 * when the notes were written ("Them" when none was recorded) is replaced by the current one, so renaming
 * a call shows the new name in its notes and their PDF without a new (paid) notes request. Only the
 * texts change; times, ratings and links stay.
 *
 * @param notes   The notes.
 * @param written The name the notes were written with (StoredCallNotes.writtenTheirName), if any.
 * @param label   The call's label now (theirLabel()).
 * @returns The notes to show (the same object when nothing changes).
 * Called from: the session page's notes, the notes PDF (core/drive/callFiles.ts); tests
 */
export function relabelNotes<
  N extends {
    summary: string[];
    questions: { question: string }[];
    nextSteps: { step: string; owner: string }[];
    unclear: { reason: string }[];
  },
>(notes: N, written: string | undefined, label: string): N {
  const from = cleanPersonName(written) || THEM_LABEL;
  if (from === label) return notes;
  const swap = (text: string) => replaceLabel(text, from, label);
  return {
    ...notes,
    summary: notes.summary.map(swap),
    questions: notes.questions.map((question) => ({
      ...question,
      question: swap(question.question),
    })),
    nextSteps: notes.nextSteps.map((step) => ({
      ...step,
      step: swap(step.step),
      owner: swap(step.owner),
    })),
    unclear: notes.unclear.map((part) => ({ ...part, reason: swap(part.reason) })),
  };
}

/**
 * The session as one call's files and screens should read it (ADR-0093): its contactName replaced by the
 * other person's name for that call (the call's own name wins), so everything that reads contactName
 * (speakerNames(), the transcript downloads, the request's speaker label) uses the call's name.
 *
 * @param session The session.
 * @param call    The call (its themName), if known.
 * @returns A copy of the session with that name (contactName '' when none is known).
 * Called from: core/drive/callFiles.ts, the session page, the live page; tests
 */
export function withTheirName<S extends Pick<Session, 'contactName'>>(
  session: S,
  call: Pick<StoredCall, 'themName'> | null | undefined,
): S {
  return { ...session, contactName: theirName(session, call) };
}

/** The parts of a transcript line the rename offer looks at. */
export interface OfferLine {
  /** The line's id (each line is looked at once). */
  id: string;
  /** Who said it. */
  speaker: 'you' | 'them';
  /** True once its words are final. */
  final: boolean;
  /** Its words. */
  text: string;
}

/**
 * ADR-0093: the name to offer as "Rename Them to …?", from the other person's final lines not looked at
 * yet. Each version of a line is looked at once (its id and words go into `checked`): a line the next words
 * of the same speaker were merged into keeps its id with longer words, so it is looked at again. A name
 * the user said Not now to in this call (`declined`, lower case) is never offered again.
 *
 * @param lines    The call's lines, oldest first.
 * @param checked  Each line already looked at, as its id and words (changed in place).
 * @param declined Names declined in this call, lower case.
 * @param exclude  Names that are not theirs (the user's own name, the company).
 * @returns The name to offer, or null.
 * Called from: LivePage.tsx; the visual rig; tests
 */
export function findNameOffer(
  lines: readonly OfferLine[],
  checked: Set<string>,
  declined: ReadonlySet<string>,
  exclude: readonly string[],
): string | null {
  for (const line of lines) {
    // Id and words: a merged line (same id, more words) is looked at again.
    const key = `${line.id} ${line.text}`;
    if (line.speaker !== 'them' || !line.final || checked.has(key)) continue;
    checked.add(key);
    const found = detectIntroducedName(line.text, exclude);
    if (found && !declined.has(found.toLowerCase())) return found;
  }
  return null;
}
