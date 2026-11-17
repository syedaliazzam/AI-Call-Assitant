/**
 * File: apps/web/scripts/lib/spend.ts
 * Purpose: Adds up what an evaluation really spent, from the token counts Claude reports, and keeps
 *          a running total in a git-ignored file, so a paid run can be checked against its budget.
 * Used by: scripts/eval-answers.ts, scripts/eval-notes.ts, scripts/measure-first-word.ts
 * Depends on: @kite/shared (AnswerUsage)
 * Architecture: docs/testing/answer-eval.md; CLAUDE.md "Claude key and spend"
 *
 * The prices are the list prices per million tokens when this was written; the Console's numbers
 * are the real bill. It holds token counts and dollars only, never prompt or answer text.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AnswerUsage } from '@kite/shared';
import { EVAL_RESULTS_DIR } from './eval-results';

/** Dollars per million tokens: input, output. Cache writes cost 1.25 × input, reads 0.1 × input. */
const PRICES: readonly { match: RegExp; input: number; output: number }[] = [
  { match: /haiku/i, input: 0.1, output: 0.5 },
  { match: /sonnet/i, input: 2, output: 10 },
  // ADR-0099: list prices on 17 Nov 2026 (OpenAI's after its 30 July cut; Google's paid tier). Cache reads are
  // priced at 0.1 × input, as for Claude, which matches both providers' published cached rates.
  { match: /gpt-5\.6-luna/i, input: 0.2, output: 1.2 },
  { match: /flash-lite/i, input: 0.3, output: 2.5 },
];

/** The running total's file, inside the git-ignored results folder. */
const LEDGER_FILE = 'spend.jsonl';

/**
 * What one request cost.
 *
 * @param model The model's name.
 * @param usage The request's token counts.
 * @returns Dollars. An unknown model is priced as Sonnet, the dearer one, so totals never read low.
 * Called from: createSpendMeter(); tests
 */
export function requestCost(model: string, usage: AnswerUsage): number {
  const price = PRICES.find((entry) => entry.match.test(model)) ?? PRICES[1]!;
  const dollars =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    usage.cache_creation_input_tokens * price.input * 1.25 +
    usage.cache_read_input_tokens * price.input * 0.1;
  return dollars / 1_000_000;
}

/** Adds up one run's spend. */
export interface SpendMeter {
  /**
   * Counts one request.
   *
   * @param model The model's name.
   * @param usage Its token counts.
   */
  add(model: string, usage: AnswerUsage): void;
  /**
   * The dollars counted so far in this run (for --max-dollars).
   *
   * @returns Dollars.
   */
  spent(): number;
  /**
   * Writes the run to the running total.
   *
   * @param label What ran, for example 'answers --only=adaptive'.
   * @returns The line to print: the run's dollars and requests, and the total so far.
   */
  finish(label: string): string;
}

/**
 * Starts a meter for one run.
 *
 * @param root The folder holding the results folder (apps/web, the scripts' working directory).
 * @returns The meter.
 * Called from: main() of the evaluation scripts; tests
 */
export function createSpendMeter(root: string = process.cwd()): SpendMeter {
  let dollars = 0;
  let requests = 0;
  return {
    add(model, usage) {
      dollars += requestCost(model, usage);
      requests += 1;
    },
    spent: () => dollars,
    finish(label) {
      mkdirSync(path.join(root, EVAL_RESULTS_DIR), { recursive: true });
      const file = path.join(root, EVAL_RESULTS_DIR, LEDGER_FILE);
      const earlier = existsSync(file)
        ? readFileSync(file, 'utf8')
            .split('\n')
            .filter((line) => line.trim() !== '')
            .reduce((sum, line) => sum + (JSON.parse(line) as { dollars: number }).dollars, 0)
        : 0;
      const at = new Date().toISOString();
      appendFileSync(file, `${JSON.stringify({ at, label, dollars, requests })}\n`);
      return `Spend: $${dollars.toFixed(4)} for ${requests} requests; ledger total $${(earlier + dollars).toFixed(4)}`;
    },
  };
}
