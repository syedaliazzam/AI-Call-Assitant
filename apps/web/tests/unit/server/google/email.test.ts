/**
 * Tests for apps/web/src/server/google/email.ts and rateLimit.ts (ADR-0072): the "saved" email carries
 * only the title, date, length, file names and the Drive link, never transcript, notes, answer or
 * document text (the builder has no such input, and extra fields given to it are ignored); HTML is
 * escaped; the idempotency key is stable per attempt and hides the ids; Resend's replies map to sent,
 * rejected and unreachable; the rate limiter allows N per window.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSavedEmail,
  emailIdempotencyKey,
  formatLength,
  formatWhen,
  sendSavedEmail,
} from '@/server/google/email';
import { createRateLimiter } from '@/server/google/rateLimit';
import type { NotificationContent } from '@/server/google/store';

/** An invented notification. */
const CONTENT: NotificationContent = {
  title: 'Acme – Backend <Engineer>',
  callStartedAt: Date.UTC(2026, 10, 11, 14, 30),
  durationMs: 42 * 60_000,
  files: [
    { name: '2026-11-11 14.30 Part 1.mkv', folder: 'Recordings' },
    { name: '2026-11-11 14.30 Transcript.txt', folder: 'Transcripts' },
    { name: '2026-11-11 14.30 Notes.pdf', folder: 'Transcripts' },
  ],
  folderUrl: 'https://drive.google.com/drive/folders/F1',
  timeZone: 'UTC',
  recipients: ['me@example.test', 'team@example.test'],
};

describe('buildSavedEmail', () => {
  it('says what was saved, when, how long, and links the folder', () => {
    const email = buildSavedEmail(CONTENT);
    expect(email.subject).toBe('Recording and transcript saved — Acme – Backend <Engineer>');
    expect(email.text).toContain('Date: Wed, 11 Nov 2026, 14:30');
    expect(email.text).toContain('Length: 42 min');
    expect(email.text).toContain('- Recordings/2026-11-11 14.30 Part 1.mkv');
    expect(email.text).toContain('Open in Drive: https://drive.google.com/drive/folders/F1');
    expect(email.text).toContain('People need access to the Drive folder to open the link.');
    expect(email.html).toContain('Backend &lt;Engineer&gt;');
    expect(email.html).not.toContain('<Engineer>');
  });

  it('never carries call text, even when a caller passes it alongside', () => {
    const secret = 'THE CANDIDATE SAID THE SECRET PRICE IS 42';
    const withExtras = {
      ...CONTENT,
      transcript: secret,
      notes: secret,
      answers: [secret],
      documents: secret,
    } as unknown as NotificationContent;
    const email = buildSavedEmail(withExtras);
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain(secret);
    }
  });

  it('formats lengths and falls back to UTC for an unknown zone', () => {
    expect(formatLength(0)).toBe('');
    expect(formatLength(20_000)).toBe('under a minute');
    expect(formatLength(65 * 60_000)).toBe('1 h 05 min');
    expect(formatWhen(CONTENT.callStartedAt, 'Not/AZone')).toMatch(/UTC$/);
  });
});

describe('emailIdempotencyKey', () => {
  it('is the same for the same attempt, different for the next, and hides the ids', () => {
    const one = emailIdempotencyKey('user-1', 'session-1', 1);
    expect(emailIdempotencyKey('user-1', 'session-1', 1)).toBe(one);
    expect(emailIdempotencyKey('user-1', 'session-1', 2)).not.toBe(one);
    expect(one).not.toContain('user-1');
    expect(one).not.toContain('session-1');
  });
});

describe('sendSavedEmail', () => {
  it('posts to Resend with the key and maps the replies', async () => {
    const seen: RequestInit[] = [];
    const reply = (status: number) => async (_url: string, init?: RequestInit) => {
      seen.push(init!);
      return new Response('{}', { status });
    };
    const config = { apiKey: 'test-key', from: 'Paramount AI <n@example.test>' };
    expect(await sendSavedEmail(reply(200), config, CONTENT, 'k1')).toBe('sent');
    expect((seen[0]!.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
    expect(JSON.parse(String(seen[0]!.body)).to).toEqual(CONTENT.recipients);
    expect(await sendSavedEmail(reply(422), config, CONTENT, 'k1')).toBe('rejected');
    expect(await sendSavedEmail(reply(500), config, CONTENT, 'k1')).toBe('unreachable');
    expect(
      await sendSavedEmail(
        async () => {
          throw new TypeError('offline');
        },
        config,
        CONTENT,
        'k1',
      ),
    ).toBe('unreachable');
  });
});

describe('createRateLimiter', () => {
  it('allows N requests in a window, per key, and again once the window has passed', () => {
    let now = 0;
    const limiter = createRateLimiter(2, 1_000, () => now);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.allow('b')).toBe(true);
    now = 1_001;
    expect(limiter.allow('a')).toBe(true);
  });
});
