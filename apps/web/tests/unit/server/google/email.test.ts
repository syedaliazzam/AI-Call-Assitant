/**
 * Tests for apps/web/src/server/google/email.ts and rateLimit.ts (ADR-0072): the "saved" email carries
 * only the title, date, length, file names and the Drive link, never transcript, notes, answer or
 * document text (the builder has no such input, and extra fields given to it are ignored); HTML is
 * escaped; the SMTP settings use TLS (465 secure, 587 STARTTLS required) with 10 s timeouts; the
 * Message-ID is stable per attempt and hides the ids; the mailer's failures map to rejected and
 * unreachable (by code only); the test email has no call data; the rate limiter allows N per window.
 * ADR-0077: the two emails of a call ("Call saved" with "Recording: uploading…"; "Recording saved" or
 * "Recording not uploaded" naming the computer), each escaped, and the right one sent for each record.
 */
import { describe, expect, it } from 'vitest';
import {
  RECORDING_UPLOADING_TEXT,
  buildCallSavedEmail,
  buildRecordingEmail,
  buildSavedEmail,
  emailMessageId,
  sendTestEmail,
  smtpFailure,
  smtpTransportOptions,
  type Mailer,
  type OutgoingEmail,
  RECORDING_PENDING_TEXT,
  emailFiles,
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
    expect(email.text).toContain('Duration: 42 min');
    // Records made before file ids were kept: labelled, without a direct link.
    expect(email.text).toContain('- Recording Part 1 (2026-11-11 14.30 Part 1.mkv)');
    expect(email.text).toContain('Open folder in Drive: https://drive.google.com/drive/folders/F1');
    expect(email.text).toContain('People need access to the Drive folder to open the links.');
    expect(email.html).toContain('Open folder in Drive</a>');
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

/** Invented SMTP settings (never a real server or password). */
const SMTP = {
  host: 'smtp.example.test',
  port: 587,
  user: 'notify@example.test',
  pass: 'not-a-real-password',
  from: 'Paramount AI <notify@example.test>',
};

describe('smtpTransportOptions', () => {
  it('uses TLS from the start on 465, requires STARTTLS on 587, and times out after 10 s', () => {
    expect(smtpTransportOptions({ ...SMTP, port: 465 })).toMatchObject({
      secure: true,
      requireTLS: false,
    });
    expect(smtpTransportOptions(SMTP)).toMatchObject({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      logger: false,
      auth: { user: 'notify@example.test', pass: 'not-a-real-password' },
    });
  });
});

describe('emailMessageId', () => {
  it('is the same for the same attempt, different for the next, hides the ids, and uses the sender domain', () => {
    const one = emailMessageId('user-1', 'session-1', 1, SMTP.from);
    expect(emailMessageId('user-1', 'session-1', 1, SMTP.from)).toBe(one);
    expect(emailMessageId('user-1', 'session-1', 2, SMTP.from)).not.toBe(one);
    expect(one).not.toContain('user-1');
    expect(one).not.toContain('session-1');
    expect(one).toMatch(/@example\.test>$/);
  });
});

describe('sending', () => {
  it('sends the built email to every recipient, and sorts failures by code', async () => {
    const seen: OutgoingEmail[] = [];
    const ok: Mailer = async (_config, message) => void seen.push(message);
    expect(await sendSavedEmail(ok, SMTP, CONTENT, '<m1@example.test>')).toBe('sent');
    expect(seen[0]).toMatchObject({ to: CONTENT.recipients, messageId: '<m1@example.test>' });
    expect(seen[0]!.subject).toContain('Recording and transcript saved');
    const failing =
      (error: object): Mailer =>
      async () => {
        throw Object.assign(new Error('x'), error);
      };
    expect(await sendSavedEmail(failing({ code: 'EAUTH' }), SMTP, CONTENT, 'm')).toBe('rejected');
    expect(await sendSavedEmail(failing({ code: 'EENVELOPE' }), SMTP, CONTENT, 'm')).toBe(
      'rejected',
    );
    expect(await sendSavedEmail(failing({ responseCode: 550 }), SMTP, CONTENT, 'm')).toBe(
      'rejected',
    );
    expect(await sendSavedEmail(failing({ responseCode: 421 }), SMTP, CONTENT, 'm')).toBe(
      'unreachable',
    );
    expect(await sendSavedEmail(failing({ code: 'ETIMEDOUT' }), SMTP, CONTENT, 'm')).toBe(
      'unreachable',
    );
    expect(smtpFailure(null)).toBe('unreachable');
  });

  it('sends the test email to one address, with no call data', async () => {
    const seen: OutgoingEmail[] = [];
    const ok: Mailer = async (_config, message) => void seen.push(message);
    expect(await sendTestEmail(ok, SMTP, 'me@example.test', 5)).toBe('sent');
    expect(seen[0]!.to).toEqual(['me@example.test']);
    expect(seen[0]!.text).not.toMatch(/transcript|notes/i);
    expect(seen[0]!.messageId).toBe('<kite-test.5@example.test>');
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

describe('file links (1.6.0)', () => {
  it('links each file directly, labelled and in order, and says when the recording is pending', () => {
    const files = [
      {
        name: 'n.pdf',
        folder: 'Transcripts',
        key: 'call:1:notes-pdf',
        fileId: 'NOTES1',
        kind: 'notes-pdf',
      },
      {
        name: 't.pdf',
        folder: 'Transcripts',
        key: 'call:1:transcript-pdf',
        fileId: 'TPDF1',
        kind: 'transcript-pdf',
      },
      {
        name: 's.webm',
        folder: 'Recordings',
        key: 'rec:r:stereo',
        fileId: 'ST1',
        kind: 'stereo',
        part: 1,
      },
      {
        name: 'p.mkv',
        folder: 'Recordings',
        key: 'rec:r:main',
        fileId: 'REC1',
        kind: 'recording',
        part: 1,
      },
    ] as const;
    expect(emailFiles([...files]).map((f) => [f.label, f.url])).toEqual([
      ['Recording Part 1', 'https://drive.google.com/file/d/REC1/view'],
      ['Stereo audio', 'https://drive.google.com/file/d/ST1/view'],
      ['Transcript (PDF)', 'https://drive.google.com/file/d/TPDF1/view'],
      ['Notes (PDF)', 'https://drive.google.com/file/d/NOTES1/view'],
    ]);
    const email = buildSavedEmail({ ...CONTENT, files: [...files], recordingPending: true });
    expect(email.text).toContain('- Recording Part 1: https://drive.google.com/file/d/REC1/view');
    expect(email.html).toContain('href="https://drive.google.com/file/d/NOTES1/view"');
    expect(email.text).toContain(RECORDING_PENDING_TEXT);
    expect(buildSavedEmail({ ...CONTENT, files: [...files] }).text).not.toContain(
      RECORDING_PENDING_TEXT,
    );
  });
});

describe('the two emails of a call (ADR-0077)', () => {
  /** A two-step call's record: the transcript and notes are in; the recording is uploading. */
  const CALL: NotificationContent = {
    ...CONTENT,
    files: [
      {
        name: '2026-11-11 14.30 Transcript.txt',
        folder: 'Transcripts',
        fileId: 'TXT1',
        kind: 'transcript-txt',
      },
      {
        name: '2026-11-11 14.30 Notes.pdf',
        folder: 'Transcripts',
        fileId: 'NOTES1',
        kind: 'notes-pdf',
      },
    ],
    rule: 'two-step',
    recordingsFolderUrl: 'https://drive.google.com/drive/folders/REC1',
    recordingPending: true,
    expected: [{ id: 'r1', part: 1, stereo: true, deviceName: 'Office <laptop>' }],
  };

  it('email 1 "Call saved": links, the Recordings folder and "Recording: uploading…"', () => {
    const email = buildCallSavedEmail(CALL);
    expect(email.subject).toBe('Call saved — Acme – Backend <Engineer>');
    expect(email.text).toContain('Date: Wed, 11 Nov 2026, 14:30');
    expect(email.text).toContain('Duration: 42 min');
    expect(email.text).toContain(RECORDING_UPLOADING_TEXT);
    expect(email.text).toContain('Recordings folder: https://drive.google.com/drive/folders/REC1');
    expect(email.text).toContain('- Notes (PDF): https://drive.google.com/file/d/NOTES1/view');
    expect(email.html).toContain('Backend &lt;Engineer&gt;');
    expect(email.html).not.toContain('<Engineer>');
    // With the recording already in: no "uploading" line.
    expect(buildCallSavedEmail({ ...CALL, recordingPending: false }).text).not.toContain(
      'uploading',
    );
  });

  it('email 1 for a call that saved no transcript still goes, with the Recordings folder', () => {
    const email = buildCallSavedEmail({ ...CALL, files: [] });
    expect(email.text).toContain('No transcript or notes were saved for this call.');
    expect(email.text).toContain('Recordings folder: https://drive.google.com/drive/folders/REC1');
  });

  it('email 2 "Recording saved", or "Recording not uploaded" naming the computer', () => {
    const recording: NotificationContent = {
      ...CALL,
      kind: 'recording',
      files: [
        { name: 'p1.mkv', folder: 'Recordings', fileId: 'REC1F', kind: 'recording', part: 1 },
      ],
    };
    const saved = buildRecordingEmail(recording);
    expect(saved.subject).toBe('Recording saved — Acme – Backend <Engineer>');
    expect(saved.text).toContain('https://drive.google.com/file/d/REC1F/view');
    const missing = buildRecordingEmail({ ...recording, files: [], recordingMissing: true });
    expect(missing.subject).toBe('Recording not uploaded — Acme – Backend <Engineer>');
    expect(missing.text).toContain('Open Paramount AI on Office <laptop> to finish the upload.');
    expect(missing.html).toContain('Office &lt;laptop&gt;');
  });

  it('sends the right one for each record', async () => {
    const sent: OutgoingEmail[] = [];
    const mailer: Mailer = async (_config, message) => {
      sent.push(message);
    };
    const config = { host: 'h', port: 465, user: 'u', pass: 'p', from: 'n@example.test' };
    await sendSavedEmail(mailer, config, CALL, '<a@b>');
    await sendSavedEmail(mailer, config, { ...CALL, kind: 'recording' }, '<c@d>');
    await sendSavedEmail(mailer, config, CONTENT, '<e@f>');
    expect(sent.map((m) => m.subject.split(' — ')[0])).toEqual([
      'Call saved',
      'Recording saved',
      'Recording and transcript saved',
    ]);
  });
});
