/**
 * File: apps/web/scripts/lib/code-sandbox.ts
 * Purpose: Checks that code in an evaluated answer runs: finds its fenced code blocks and runs each
 *          Python or JavaScript one in a sandboxed worker (code-sandbox-worker.mjs) with a time limit.
 *          Other languages are reported as not run, never as passed.
 * Used by: scripts/eval-answers.ts
 * Depends on: node:worker_threads, scripts/lib/code-sandbox-worker.mjs
 * Architecture: docs/testing/answer-eval.md (code in answers is executed)
 */
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

/** How long one block may run, loading Python included. */
const TIME_LIMIT_MS = 60_000;

/** A code block in an answer. */
export interface CodeBlock {
  /** The language, lower case ('' when it names none). */
  language: string;
  /** The code. */
  code: string;
}

/** What running an answer's code found. */
export interface CodeResult {
  /** How many blocks the answer has. */
  blocks: number;
  /** How many ran without an error. */
  ran: number;
  /** How many failed. */
  failed: number;
  /** How many are in a language the sandbox does not run. */
  notRun: number;
  /** The first failure's last line, for diagnosis. */
  error?: string;
}

/**
 * Finds the fenced code blocks in an answer.
 *
 * @param text The answer.
 * @returns The closed blocks, in order.
 * Called from: runAnswerCode(); tests
 */
export function codeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  for (const match of text.matchAll(
    /^[ \t]*```[ \t]*([\w+#-]*)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm,
  )) {
    blocks.push({ language: (match[1] ?? '').toLowerCase(), code: match[2] ?? '' });
  }
  return blocks;
}

/**
 * The sandbox's name for a language.
 *
 * @param language The language an answer names.
 * @returns 'python', 'javascript', or null when the sandbox cannot run it.
 * Called from: runAnswerCode(); tests
 */
export function sandboxLanguage(language: string): 'python' | 'javascript' | null {
  if (['python', 'py', 'python3'].includes(language)) return 'python';
  if (['javascript', 'js', 'node'].includes(language)) return 'javascript';
  return null;
}

/**
 * Runs one block in a new worker with no environment variables (so no API key).
 *
 * @param language The sandbox language.
 * @param code     The code.
 * @returns Whether it ran, and its error when not.
 * Called from: runAnswerCode()
 */
function runBlock(
  language: 'python' | 'javascript',
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const worker = new Worker(
      fileURLToPath(new URL('./code-sandbox-worker.mjs', import.meta.url)),
      {
        workerData: { language, code },
        env: {},
        // tsx's loader is not needed in the worker, and the worker must not inherit its flags.
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ ok: false, error: 'time limit reached' });
    }, TIME_LIMIT_MS);
    worker.once('message', (message: { ok: boolean; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(message);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message.slice(0, 200) });
    });
  });
}

/**
 * Runs every block of an answer.
 *
 * @param text The answer.
 * @returns What ran and what failed.
 * Called from: scripts/eval-answers.ts
 */
export async function runAnswerCode(text: string): Promise<CodeResult> {
  const blocks = codeBlocks(text);
  const result: CodeResult = { blocks: blocks.length, ran: 0, failed: 0, notRun: 0 };
  for (const block of blocks) {
    const language = sandboxLanguage(block.language);
    if (!language) {
      result.notRun += 1;
      continue;
    }
    const outcome = await runBlock(language, block.code);
    if (outcome.ok) {
      result.ran += 1;
    } else {
      result.failed += 1;
      result.error ??= outcome.error;
    }
  }
  return result;
}
