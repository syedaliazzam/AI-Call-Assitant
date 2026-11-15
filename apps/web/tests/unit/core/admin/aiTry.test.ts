/**
 * Tests for apps/web/src/core/admin/aiTry.ts (ADR-0083), with this device's storage in memory
 * (fake-indexeddb): the session list (newest first, labelled by company and role), and runAiTry():
 * posts the block, draft and sample, adds the picked session as a call sends it, and turns a refusal
 * or a network failure into a message to show.
 */
import 'fake-indexeddb/auto';
import type { AiTryRequest } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listTrySessions, runAiTry } from '@/core/admin/aiTry';
import { createSession, type NewSessionInput } from '@/core/storage/sessions';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

/** An invented session's fields. */
const INPUT: NewSessionInput = {
  type: 'regular',
  company: 'Northwind (invented)',
  role: 'Renewal',
  description: 'A renewal call.',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: '',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
};

describe('listTrySessions', () => {
  it('lists this device sessions newest first, labelled by company and role', async () => {
    await createSession(INPUT, 1_000);
    await createSession({ ...INPUT, company: '', role: '' }, 2_000);
    const options = await listTrySessions();
    expect(options.map((option) => option.label)).toEqual([
      'Untitled session',
      'Northwind (invented) · Renewal',
    ]);
  });
});

describe('runAiTry', () => {
  it('posts the try, with the picked session as a call sends it', async () => {
    const session = await createSession(INPUT, 1_000);
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ kind: 'answer', text: 'Hi.', meta: null }),
    );
    const outcome = await runAiTry(
      { block: 'live', draft: 'Be brief.', sample: 'Price?', sessionId: session.id },
      fetchImpl,
    );
    expect(outcome).toEqual({ ok: true, reply: { kind: 'answer', text: 'Hi.', meta: null } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/admin/ai-instructions/try');
    const body = JSON.parse(String(init?.body)) as AiTryRequest;
    expect(body).toMatchObject({ block: 'live', draft: 'Be brief.', sample: 'Price?' });
    expect(body.session?.company).toBe('Northwind (invented)');
  });

  it('sends no session when none is picked', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ kind: 'answer', text: 'Hi.', meta: null }),
    );
    await runAiTry({ block: 'ask', draft: '', sample: 'Hi?', sessionId: '' }, fetchImpl);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as AiTryRequest;
    expect(body).not.toHaveProperty('session');
  });

  it("shows the server's message on a refusal, and a fixed one when offline", async () => {
    const refused = vi.fn<typeof fetch>(async () =>
      Response.json({ code: 'daily_limit', message: 'Limit reached.' }, { status: 429 }),
    );
    expect(
      await runAiTry({ block: 'live', draft: '', sample: 'x', sessionId: '' }, refused),
    ).toEqual({ ok: false, message: 'Limit reached.' });
    const offline = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('offline')));
    const outcome = await runAiTry(
      { block: 'live', draft: '', sample: 'x', sessionId: '' },
      offline,
    );
    expect(outcome.ok).toBe(false);
  });
});
