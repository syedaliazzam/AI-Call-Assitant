/**
 * File: apps/web/scripts/lib/stt-score.ts
 * Purpose: Scores speech-to-text hypotheses for the Day 6 trial (ADR-0027 "How it is measured"):
 *          reads the names list, decides whether a listed term was written exactly right, splits
 *          terms into names and technical terms, and adds up word error rates and percentiles.
 *          Pure functions, so the rules are unit-tested and fixed before the trial runs.
 * Used by: scripts/stt-trial.ts
 * Depends on: src/core/stt/wer.ts (normalizeWords, wordErrorRate)
 * Architecture: docs/decisions/ADR-0027-desktop-speech-engine.md; day-06 Stage 1
 *
 * Hypothesis text is the developer's voice: nothing here logs it.
 */
import { normalizeWords, wordErrorRate } from '../../src/core/stt/wer';

/**
 * The listed terms that count as technical terms (compared in compact form, see compact()); every
 * other listed term is a name (a person, company, place or product people say on calls). Fixed
 * before the trial (ADR-0027).
 */
export const TECH_TERMS: readonly string[] = [
  'Electron',
  'Next.js',
  'sherpa onnx',
  'Zipformer',
  'Parakeet',
  'Whisper',
  'IndexedDB',
  'Better Auth',
  'Kubernetes',
  'PostgreSQL',
  'JSON',
  'HTTPS',
  'OAuth',
  'WebSocket',
  'TypeScript',
  'GPT',
  'Llama',
  'SLA',
  'AWS',
  'GitHub Actions',
  'RAG',
  'LLM',
  'retriever',
  'generator',
  'hybrid retrieval',
  'BM25',
  'embeddings',
  'vector database',
  'LangChain',
  'Pinecone',
  'FastAPI',
  'async',
  'Python',
  'asyncio',
  'hallucinations',
  'retrieved evidence',
  'LoRA',
  'Hugging Face',
  'forward-deployed AI engineering',
];

/** One sentence of the names list. */
export interface NamesSentence {
  /** Its number in the list, from 1 (the clip's number). */
  index: number;
  /** The sentence as read. */
  sentence: string;
  /** The terms scored in it. */
  terms: string[];
}

/**
 * Reads the names list: "<sentence> | <term>; <term>", skipping comments and blank lines.
 *
 * @param text The file's text.
 * @returns The sentences, numbered from 1.
 * Called from: stt-trial.ts; tests
 */
export function parseNamesList(text: string): NamesSentence[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line, index) => {
      const [sentence = '', terms = ''] = line.split('|');
      return {
        index: index + 1,
        sentence: sentence.trim(),
        terms: terms
          .split(';')
          .map((term) => term.trim())
          .filter(Boolean),
      };
    });
}

/**
 * A term or word without case, punctuation or spaces, so spelling is compared and formatting is
 * not: "Next.js" = "NEXT JS", "LangChain" = "lang chain", "BM25" = "BM 25".
 *
 * @param text The text.
 * @returns The compact form.
 * Called from: termFound(), isTechTerm()
 */
export function compact(text: string): string {
  return normalizeWords(text).join('');
}

/**
 * Whether a listed term was written exactly right in a hypothesis: some run of whole words,
 * joined, equals the term. Case, punctuation and spacing do not matter; a possessive "'s" on the
 * last word is allowed; part of a word is not a match ("kite" is not in "kites").
 *
 * @param term       The listed term.
 * @param hypothesis What the engine wrote.
 * @returns True when found.
 * Called from: scoreTerms(); tests
 */
export function termFound(term: string, hypothesis: string): boolean {
  const target = compact(term);
  const words = normalizeWords(hypothesis);
  for (let start = 0; start < words.length; start += 1) {
    let joined = '';
    for (let end = start; end < words.length && joined.length < target.length; end += 1) {
      joined += words[end]!;
      if (joined === target || joined.replace(/'s$/, '') === target) return true;
    }
  }
  return false;
}

/**
 * Whether a listed term counts as a technical term (TECH_TERMS).
 *
 * @param term The listed term.
 * @returns True for a technical term; false for a name.
 * Called from: scoreTerms(); tests
 */
export function isTechTerm(term: string): boolean {
  const target = compact(term);
  return TECH_TERMS.some((tech) => compact(tech) === target);
}

/** Term accuracy for one kind of term. */
export interface TermScore {
  /** Terms written exactly right. */
  right: number;
  /** Terms scored. */
  total: number;
}

/** Term accuracy, overall and split. */
export interface TermScores {
  /** Every listed term: the "name accuracy" the ADR-0027 rule uses. */
  all: TermScore;
  /** Names only. */
  names: TermScore;
  /** Technical terms only. */
  tech: TermScore;
}

/**
 * Scores the listed terms of the recorded sentences.
 *
 * @param sentences   The sentences that have a clip.
 * @param hypotheses  What the engine wrote, by sentence number.
 * @returns The scores.
 * Called from: stt-trial.ts; tests
 */
export function scoreTerms(
  sentences: readonly NamesSentence[],
  hypotheses: ReadonlyMap<number, string>,
): TermScores {
  const scores: TermScores = {
    all: { right: 0, total: 0 },
    names: { right: 0, total: 0 },
    tech: { right: 0, total: 0 },
  };
  for (const { index, terms } of sentences) {
    const hypothesis = hypotheses.get(index) ?? '';
    for (const term of terms) {
      const found = termFound(term, hypothesis);
      for (const score of [scores.all, isTechTerm(term) ? scores.tech : scores.names]) {
        score.total += 1;
        if (found) score.right += 1;
      }
    }
  }
  return scores;
}

/**
 * Word error rate over several clips, weighted by their words (errors ÷ reference words).
 *
 * @param pairs Reference and hypothesis of each clip.
 * @returns The rate (0.17 = 17%), or 0 when there are no words.
 * Called from: stt-trial.ts; tests
 */
export function overallWer(pairs: readonly { reference: string; hypothesis: string }[]): number {
  let errors = 0;
  let words = 0;
  for (const { reference, hypothesis } of pairs) {
    const result = wordErrorRate(reference, hypothesis);
    errors += result.substitutions + result.deletions + result.insertions;
    words += result.referenceWords;
  }
  return words === 0 ? 0 : errors / words;
}

/**
 * Scales a clip so its loudest sample reaches the target: a plain volume change, nothing else.
 * The names clips were recorded with auto-gain off, while the live microphone has it on, so they
 * are far quieter than a live call (ADR-0027).
 *
 * @param samples The samples.
 * @param target  The loudest sample after scaling (0…1).
 * @returns New samples; a silent clip is returned unchanged.
 * Called from: stt-trial.ts (names clips); tests
 */
export function levelToPeak(samples: Float32Array, target: number): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak === 0) return samples;
  const gain = target / peak;
  return samples.map((sample) => sample * gain);
}

/**
 * A percentile by the nearest-rank method.
 *
 * @param values The values.
 * @param percent The percentile, 0–100.
 * @returns The value, or 0 for no values.
 * Called from: stt-trial.ts; tests
 */
export function percentile(values: readonly number[], percent: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[rank - 1]!;
}
