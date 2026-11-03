/**
 * File: apps/web/src/core/stt/spokenNumbers.ts
 * Purpose: Turns a key term that contains digits into the spoken forms the speech recognizer would
 *          actually write, so the term can still be a hotword. The English models' alphabet is
 *          upper-case letters and the apostrophe only (see hotwords.ts), so "BM25" cleaned to the
 *          alphabet loses its number and "H100" becomes a single useless letter. Instead we spell
 *          the number out: "BM25" -> "BM TWENTY FIVE", "H100" -> "H ONE HUNDRED" / "H ONE ZERO
 *          ZERO", "2026" -> "TWENTY TWENTY SIX" / "TWO THOUSAND TWENTY SIX". At most 2 variants per
 *          term (ADR-0027, Day 6 Stage 4c follow-up), because each hotword adds decoding work.
 * Used by: src/core/stt/sessionHotwords.ts (hotword building), src/core/transcript/display.ts
 *          (mapping the spoken form back to the typed spelling for display)
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0027
 *
 * These are pure functions so the readings are unit-tested and fixed. Numbers above 9999 are left
 * as their digits spelled one by one, which is enough for product names and recent years.
 */

/** At most this many spoken variants per term (ADR-0027). */
export const MAX_SPOKEN_VARIANTS = 2;

/** Zero to nineteen. */
const ONES = [
  'ZERO',
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
  'TEN',
  'ELEVEN',
  'TWELVE',
  'THIRTEEN',
  'FOURTEEN',
  'FIFTEEN',
  'SIXTEEN',
  'SEVENTEEN',
  'EIGHTEEN',
  'NINETEEN',
];

/** Tens, indexed by the tens digit (0 and 1 are unused). */
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

/**
 * A whole number under 100 as words.
 *
 * @param n 0–99.
 * @returns For example "TWENTY FIVE".
 * Called from: below1000(), yearWords()
 */
function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  const ones = n % 10;
  return ones === 0 ? tens : `${tens} ${ONES[ones]}`;
}

/**
 * A whole number under 1000 as words.
 *
 * @param n 0–999.
 * @returns For example "ONE HUNDRED", "TWO HUNDRED FIFTY".
 * Called from: numberToWords()
 */
function below1000(n: number): string {
  if (n < 100) return below100(n);
  const hundreds = `${ONES[Math.floor(n / 100)]} HUNDRED`;
  const rest = n % 100;
  return rest === 0 ? hundreds : `${hundreds} ${below100(rest)}`;
}

/**
 * A whole number 0–9999 as cardinal words.
 *
 * @param n 0–9999.
 * @returns For example "TWENTY FIVE", "ONE HUNDRED", "TWO THOUSAND TWENTY SIX".
 * Called from: spokenVariants()
 */
export function numberToWords(n: number): string {
  if (n < 1000) return below1000(n);
  const thousands = `${ONES[Math.floor(n / 1000)]} THOUSAND`;
  const rest = n % 1000;
  return rest === 0 ? thousands : `${thousands} ${below1000(rest)}`;
}

/**
 * A run of digits read one by one.
 *
 * @param digits A string of digits, for example "100".
 * @returns For example "ONE ZERO ZERO".
 * Called from: spokenVariants()
 */
export function digitsToWords(digits: string): string {
  return [...digits].map((digit) => ONES[Number(digit)]!).join(' ');
}

/**
 * A four-digit year read in pairs: 2026 -> "TWENTY TWENTY SIX", 1905 -> "NINETEEN ZERO FIVE",
 * 1900 -> "NINETEEN HUNDRED".
 *
 * @param n 1000–9999.
 * @returns The paired reading.
 * Called from: spokenVariants()
 */
function yearWords(n: number): string {
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${below100(high)} HUNDRED`;
  if (low < 10) return `${below100(high)} ZERO ${ONES[low]}`;
  return `${below100(high)} ${below100(low)}`;
}

/**
 * The spoken-word variants of a term that contains digits (at most MAX_SPOKEN_VARIANTS), ready to
 * be cleaned into hotwords. A term with no digit returns [].
 *
 * The order is the readings most likely to be said first:
 * - a bare four-digit number (a year): the paired reading, then the full cardinal reading;
 * - otherwise: the cardinal reading, then the digit-by-digit reading.
 * Duplicates are removed, so a single digit ("GPT4") gives one variant.
 *
 * @param term The term as the user typed it (letters, digits, separators).
 * @returns Up to MAX_SPOKEN_VARIANTS spoken forms (upper-case words), or [] when there is no digit.
 * Called from: sessionHotwords.buildHotwords(), display.displayTerms()
 */
export function spokenVariants(term: string): string[] {
  if (!/\d/.test(term)) return [];
  // A term with no letters is read out only when it is a four-digit year ("2026"). Spelling an
  // arbitrary number ("12345", a phone number) would add common words that match everywhere.
  if (!/[A-Za-z]/.test(term) && !/^\d{4}$/.test(term.trim())) return [];
  const cardinal = (digits: string) =>
    Number(digits) <= 9999 ? numberToWords(Number(digits)) : digitsToWords(digits);
  const withCardinal = term.replace(/\d+/g, (digits) => ` ${cardinal(digits)} `);
  const withDigits = term.replace(/\d+/g, (digits) => ` ${digitsToWords(digits)} `);
  const ordered = /^\d{4}$/.test(term.trim())
    ? [yearWords(Number(term.trim())), withCardinal]
    : [withCardinal, withDigits];
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const raw of ordered) {
    const words = raw
      .replace(/[^A-Za-z]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
    if (words !== '' && !seen.has(words)) {
      seen.add(words);
      variants.push(words);
      if (variants.length >= MAX_SPOKEN_VARIANTS) break;
    }
  }
  return variants;
}
