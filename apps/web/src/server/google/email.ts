/**
 * File: apps/web/src/server/google/email.ts
 * Purpose: The "saved to Google Drive" email (ADR-0072): its subject, plain text and HTML, built only
 *          from the session title, date, length, the saved files' names and the Drive folder link
 *          (never transcript, notes, answer or document text: those are not inputs), and sending it
 *          through Resend with an idempotency key so one attempt is never delivered twice.
 * Used by: src/server/google/api.ts (notify, retry)
 * Depends on: @kite/shared (savedHeadline), src/server/google/{config,oauth}.ts (types)
 * Architecture: ADR-0072; docs/deploy/google-drive.md (Resend setup)
 *
 * Nothing here logs addresses, titles or file names. The HTML has no colours: email clients ignore the
 * theme's CSS variables, and the app keeps every colour in src/ui/tokens/theme.css.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { savedHeadline } from '@kite/shared';
import type { EmailConfig } from './config';
import type { FetchLike } from './oauth';
import type { NotificationContent } from './store';

/** Resend's send endpoint. */
export const RESEND_URL = 'https://api.resend.com/emails';

/** A built email. */
export interface SavedEmail {
  /** The subject line. */
  subject: string;
  /** The plain-text body. */
  text: string;
  /** The HTML body. */
  html: string;
}

/**
 * Escapes text for HTML.
 * @param text The text.
 * @returns The escaped text.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A call's length for the email: "42 min", "1 h 05 min", "under a minute", or "" when unknown.
 * @param ms The length, ms.
 * @returns The words.
 * Called from: buildSavedEmail(); tests
 */
export function formatLength(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/**
 * The call's date and time in the person's time zone ("Wed, 11 Nov 2026, 14:30"), UTC when the zone is
 * not one Node knows.
 * @param at       Unix ms.
 * @param timeZone An IANA zone name.
 * @returns The words.
 * Called from: buildSavedEmail(); tests
 */
export function formatWhen(at: number, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(at);
  } catch {
    return `${new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(at)} UTC`;
  }
}

/**
 * Builds the email. Its only inputs are the fields below, so no call content can appear in it.
 *
 * @param content The stored notification: title, start, length, files, folder link, time zone.
 * @returns Subject, text and HTML.
 * Called from: sendSavedEmail(); tests
 */
export function buildSavedEmail(
  content: Pick<
    NotificationContent,
    'title' | 'callStartedAt' | 'durationMs' | 'files' | 'folderUrl' | 'timeZone'
  >,
): SavedEmail {
  const headline = savedHeadline(content.files);
  const when = formatWhen(content.callStartedAt, content.timeZone);
  const length = formatLength(content.durationMs);
  const files = content.files.map((file) => `${file.folder}/${file.name}`);
  const note = 'People need access to the Drive folder to open the link.';
  const footer = 'Sent by Paramount AI when a call is saved to Google Drive.';
  const text = [
    `${headline} — ${content.title}`,
    '',
    `Date: ${when}`,
    ...(length ? [`Length: ${length}`] : []),
    '',
    'Files:',
    ...files.map((file) => `- ${file}`),
    '',
    `Open in Drive: ${content.folderUrl}`,
    '',
    note,
    footer,
    '',
  ].join('\n');
  const row = (label: string, value: string) =>
    `<tr><td style="padding:2px 12px 2px 0">${escapeHtml(label)}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`;
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">',
    `<p style="font-size:16px;font-weight:bold;margin:0 0 12px">${escapeHtml(headline)} — ${escapeHtml(content.title)}</p>`,
    '<table style="border-collapse:collapse;margin:0 0 12px">',
    row('Date', when),
    ...(length ? [row('Length', length)] : []),
    '</table>',
    '<p style="margin:0 0 4px;font-weight:bold">Files</p>',
    `<ul style="margin:0 0 16px;padding-left:20px">${files.map((file) => `<li>${escapeHtml(file)}</li>`).join('')}</ul>`,
    `<p style="margin:0 0 16px"><a href="${escapeHtml(content.folderUrl)}" style="font-weight:bold">Open in Drive ↗</a></p>`,
    `<p style="margin:0;font-size:12px">${escapeHtml(note)}<br>${escapeHtml(footer)}</p>`,
    '</div>',
  ].join('');
  return { subject: `${headline} — ${content.title}`, text, html };
}

/**
 * The idempotency key for one sending attempt: the same account, session and attempt always give the
 * same key, so Resend delivers one email even if the request is repeated (a timeout, a retry).
 * Hashed, so neither id appears in Resend's records.
 *
 * @param userId    The account.
 * @param sessionId The session.
 * @param attempt   The attempt number (1 for the first; a Settings Retry is the next).
 * @returns The key.
 * Called from: api.ts; tests
 */
export function emailIdempotencyKey(userId: string, sessionId: string, attempt: number): string {
  const hash = createHash('sha256').update(`${userId}\n${sessionId}`).digest('hex').slice(0, 40);
  return `kite-drive-saved/${hash}/${attempt}`;
}

/**
 * Sends the email through Resend.
 *
 * @param fetchFn The fetch.
 * @param config  The Resend key and sender.
 * @param content The stored notification (recipients included).
 * @param key     The idempotency key (emailIdempotencyKey()).
 * @returns 'sent', or a short failure code: 'rejected' (Resend refused it: a sender or address
 *          problem) or 'unreachable' (network or Resend's server error).
 * Called from: api.ts (notify, retry); tests
 */
export async function sendSavedEmail(
  fetchFn: FetchLike,
  config: EmailConfig,
  content: NotificationContent,
  key: string,
): Promise<'sent' | 'rejected' | 'unreachable'> {
  const email = buildSavedEmail(content);
  try {
    const response = await fetchFn(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        from: config.from,
        to: content.recipients,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      cache: 'no-store',
    });
    if (response.ok) return 'sent';
    return response.status >= 500 || response.status === 429 ? 'unreachable' : 'rejected';
  } catch {
    return 'unreachable';
  }
}
