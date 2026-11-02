/**
 * File: apps/web/scripts/verify-setup.ts
 * Purpose: Developer-only check of parity Phase 2's paid features against the real API: reads one
 *          real public job page (server/job-page.ts, server/job-import.ts) and writes one Answer
 *          preview (server/preview.ts). Also confirms private addresses are refused without any
 *          request being sent. Prints which fields were found, sizes and token counts only: never
 *          the page or what was extracted.
 *          Usage: pnpm --filter web verify:setup <url of a public job page>
 *          Sends 2 Claude requests with the fast model (about $0.01).
 * Used by: the "verify:setup" script in apps/web/package.json (by hand; never in CI)
 * Depends on: src/server/job-page.ts, src/server/job-import.ts, src/server/preview.ts,
 *             src/server/env.ts, scripts/lib/require-key.ts
 * Key: refuses to run without ANTHROPIC_API_KEY. A paid run: agree it, with its estimated cost,
 *      with the developer first (CLAUDE.md "Claude key and spend").
 * Architecture: ADR-0029
 *
 * Runs like verify-warm.ts: tsx with `--env-file=.env.local` and `--conditions=react-server`.
 */
import { getClaudeEnv } from '../src/server/env';
import { extractJobDetails } from '../src/server/job-import';
import { fetchJobPage, JobPageError, pageText } from '../src/server/job-page';
import { generatePreview } from '../src/server/preview';
import { requireKey } from './lib/require-key';

/** Addresses that must be refused. */
const PRIVATE_URLS = [
  'http://169.254.169.254/latest/meta-data/',
  'http://127.0.0.1/',
  'http://localhost/',
  'http://[::1]/',
  'http://10.0.0.1/',
];

/**
 * Runs the checks.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) throw new Error('--usage: verify:setup <url of a public job page>');
  requireKey('verify-setup');
  const env = getClaudeEnv();
  let failed = false;

  for (const address of PRIVATE_URLS) {
    try {
      await fetchJobPage(address);
      console.log(`FAIL ${address}: fetched`);
      failed = true;
    } catch (error) {
      const reason = error instanceof JobPageError ? error.reason : 'other';
      const ok = reason === 'blocked';
      failed ||= !ok;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${address}: ${reason}`);
    }
  }

  const page = await fetchJobPage(url);
  const text = pageText(page.body);
  console.log(`page: ${page.body.length} bytes, ${text.length} characters of text`);
  const { fields, usage } = await extractJobDetails(text, env.modelFast);
  const found = {
    company: fields.company.length,
    role: fields.role.length,
    description: fields.description.length,
  };
  const ok = found.company > 0 && found.role > 0 && found.description > 200;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} job import, field lengths:`, found, usage);

  const preview = await generatePreview(
    {
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      question: 'behavioural',
    },
    env.modelFast,
  );
  const lines = preview.text.split('\n').filter((line) => line.trim() !== '').length;
  const previewOk = lines >= 2;
  failed ||= !previewOk;
  console.log(`${previewOk ? 'PASS' : 'FAIL'} preview: ${lines} lines`, preview.usage);
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // The error's name and status only: an API error message could quote the request.
  const status = (error as { status?: number }).status;
  const name = error instanceof Error ? error.name : 'unknown';
  const message = error instanceof Error && error.message.startsWith('--') ? error.message : name;
  console.error(`verify-setup: failed (${message}${status ? `, HTTP ${status}` : ''})`);
  process.exitCode = 1;
});
