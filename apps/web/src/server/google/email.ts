/**
 * File: apps/web/src/server/google/email.ts
 * Purpose: The "saved to Google Drive" email (ADR-0072): its subject, plain text and HTML, built only
 *          from the session title, date, length, the saved files' names and the Drive folder link
 *          (never transcript, notes, answer or document text: those are not inputs), the test email,
 *          and sending through SMTP (nodemailer): port 465 with TLS from the start, any other port with
 *          STARTTLS required (never plain text), 10-second timeouts. Each attempt has a fixed Message-ID.
 * Used by: src/server/google/api.ts (notify, retry, test email)
 * Depends on: nodemailer, @kite/shared (savedHeadline), src/server/google/{config,store}.ts (types)
 * Architecture: ADR-0072; docs/deploy/google-drive.md (SMTP setup)
 *
 * Nothing here logs: not the password, addresses, titles, file names, or the server's reply text. The HTML has no colours: email clients ignore the
 * theme's CSS variables, and the app keeps every colour in src/ui/tokens/theme.css.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { savedHeadline } from '@kite/shared';
import { createTransport } from 'nodemailer';
import type { EmailConfig } from './config';
import type { NotificationContent } from './store';

/** Connect, greeting and socket timeouts for the SMTP server, ms. */
export const SMTP_TIMEOUT_MS = 10_000;

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

/** One message to send. */
export interface OutgoingEmail {
  /** The recipients. */
  to: string[];
  /** The subject line. */
  subject: string;
  /** The plain-text body. */
  text: string;
  /** The HTML body, when there is one. */
  html?: string;
  /** The Message-ID header (fixed per attempt). */
  messageId: string;
}

/**
 * Sends one message (nodemailer over SMTP; tests pass a fake).
 * @param config  The server, account and sender.
 * @param message The message.
 * @returns When the server accepted it.
 * @throws The transport's error (its code says why) when it did not.
 */
export type Mailer = (config: EmailConfig, message: OutgoingEmail) => Promise<void>;

/**
 * The nodemailer settings for a server: port 465 is TLS from the start; any other port (587) must
 * upgrade with STARTTLS or the message is not sent, so the password never crosses in plain text.
 *
 * @param config The server, account and sender.
 * @returns The SMTP transport options.
 * Called from: smtpMailer(); tests
 */
export function smtpTransportOptions(config: EmailConfig) {
  const secure = config.port === 465;
  return {
    host: config.host,
    port: config.port,
    secure,
    requireTLS: !secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    tls: { minVersion: 'TLSv1.2' as const },
    // nodemailer's own logging stays off: it could print addresses or the server's replies.
    logger: false,
    debug: false,
  };
}

/**
 * The real mailer: one SMTP connection per message (a few emails a day; nothing to pool).
 * @param config  The server, account and sender.
 * @param message The message.
 * @returns When the server accepted it.
 * Called from: api.ts (realGoogleDeps)
 */
export const smtpMailer: Mailer = async (config, message) => {
  const transport = createTransport(smtpTransportOptions(config));
  try {
    await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      messageId: message.messageId,
    });
  } finally {
    transport.close();
  }
};

/** Error codes nodemailer gives when the server refused (not a network problem). */
const REFUSED_CODES = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ENOAUTH']);

/**
 * Sorts a send failure: refused by the server (account, password, sender or address) or not reached
 * (host, port, network, a temporary 4xx). Only the error's code and reply number are read, never its
 * text.
 *
 * @param error What the mailer threw.
 * @returns 'rejected' or 'unreachable'.
 * Called from: sendSavedEmail(), sendTestEmail(); tests
 */
export function smtpFailure(error: unknown): 'rejected' | 'unreachable' {
  const failure = error as { code?: unknown; responseCode?: unknown } | null;
  if (typeof failure?.code === 'string' && REFUSED_CODES.has(failure.code)) return 'rejected';
  if (typeof failure?.responseCode === 'number' && failure.responseCode >= 500) return 'rejected';
  return 'unreachable';
}

/**
 * The Message-ID of one sending attempt: the same account, session and attempt always give the same
 * id, so a repeated attempt is recognisably the same message. Hashed, so neither id appears in mail
 * headers; the domain is the sender's.
 *
 * @param userId    The account.
 * @param sessionId The session.
 * @param attempt   The attempt number (1 for the first; a Settings Retry is the next).
 * @param from      The sender (its domain ends the id).
 * @returns For example "<kite-drive-saved.3f2a….1@paramountintelligence.co>".
 * Called from: api.ts; tests
 */
export function emailMessageId(
  userId: string,
  sessionId: string,
  attempt: number,
  from: string,
): string {
  const hash = createHash('sha256').update(`${userId}\n${sessionId}`).digest('hex').slice(0, 40);
  const domain = /@([A-Za-z0-9.-]+)/.exec(from)?.[1] ?? 'paramount.invalid';
  return `<kite-drive-saved.${hash}.${attempt}@${domain}>`;
}

/**
 * Sends the "saved" email.
 *
 * @param mailer    The mailer.
 * @param config    The server, account and sender.
 * @param content   The stored notification (recipients included).
 * @param messageId The attempt's Message-ID (emailMessageId()).
 * @returns 'sent', 'rejected' or 'unreachable' (smtpFailure()).
 * Called from: api.ts (notify, retry); tests
 */
export async function sendSavedEmail(
  mailer: Mailer,
  config: EmailConfig,
  content: NotificationContent,
  messageId: string,
): Promise<'sent' | 'rejected' | 'unreachable'> {
  const email = buildSavedEmail(content);
  try {
    await mailer(config, { to: content.recipients, ...email, messageId });
    return 'sent';
  } catch (error) {
    return smtpFailure(error);
  }
}

/**
 * Sends a test email to one address (the signed-in person), saying where "saved" emails will come
 * from. No call data of any kind.
 *
 * @param mailer The mailer.
 * @param config The server, account and sender.
 * @param to     The person's own address.
 * @param now    The clock (the Message-ID).
 * @returns 'sent', 'rejected' or 'unreachable'.
 * Called from: handleTestEmail() in api.ts; tests
 */
export async function sendTestEmail(
  mailer: Mailer,
  config: EmailConfig,
  to: string,
  now: number,
): Promise<'sent' | 'rejected' | 'unreachable'> {
  const domain = /@([A-Za-z0-9.-]+)/.exec(config.from)?.[1] ?? 'paramount.invalid';
  try {
    await mailer(config, {
      to: [to],
      subject: 'Paramount AI test email',
      text: [
        'This is a test email from Paramount AI.',
        '',
        'Emails saying a call was saved to Google Drive will come from this address.',
        'Sent because you pressed "Send test email" in Settings.',
        '',
      ].join('\n'),
      messageId: `<kite-test.${now}@${domain}>`,
    });
    return 'sent';
  } catch (error) {
    return smtpFailure(error);
  }
}
