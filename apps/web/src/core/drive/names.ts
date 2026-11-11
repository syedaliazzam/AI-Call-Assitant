/**
 * File: apps/web/src/core/drive/names.ts
 * Purpose: The names Kite gives folders and files in Google Drive (ADR-0072), in the person's local
 *          time and safe on every system: the session folder "<YYYY-MM-DD> <Company or title> – <Session
 *          title>", its "Recordings" and "Transcripts" subfolders, and the files "<YYYY-MM-DD HH.mm> Part
 *          N.mkv", "… Part N stereo.webm", "… Transcript.txt", "… Transcript.pdf" and "… Notes.pdf".
 * Used by: src/core/drive/uploader.ts; tests
 * Depends on: src/core/storage/types.ts (Session; core may not import features, so the type words
 *             are kept here in SESSION_TYPE_WORDS)
 * Architecture: ADR-0072
 */
import type { Session, SessionType } from '../storage/types';

/** The longest name part kept (Drive allows far more; long names are hard to read in lists). */
export const MAX_NAME_PART = 80;

/** How a session without a company or title is named: "<Type> call". */
const SESSION_TYPE_WORDS: Readonly<Record<SessionType, string>> = {
  interview: 'Interview',
  regular: 'Regular',
  mock: 'Mock',
};

/**
 * Makes text safe as a file or folder name on Windows, macOS and Drive: no control characters, none of
 * \ / : * ? " < > |, single spaces, no leading or trailing dots or spaces, and at most `max` characters
 * (cut at a word when it can be).
 *
 * @param text The text.
 * @param max  The most characters kept.
 * @returns The safe text ('' when nothing is left).
 * Called from: the builders below; tests
 */
export function sanitiseName(text: string, max: number = MAX_NAME_PART): string {
  let clean = text
    // Control characters (including newlines and tabs) become spaces.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (clean.length > max) {
    const cut = clean.slice(0, max);
    const space = cut.lastIndexOf(' ');
    clean = (space > max / 2 ? cut.slice(0, space) : cut).replace(/[.\s]+$/g, '');
  }
  return clean;
}

/**
 * A moment as local date and time parts.
 *
 * @param at Unix ms.
 * @returns date "YYYY-MM-DD" and time "HH.mm", in this computer's time zone.
 * Called from: the builders below; tests
 */
export function localStamp(at: number): { date: string; time: string } {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`,
    // A dot, not a colon: a colon is not allowed in Windows file names.
    time: `${two(d.getHours())}.${two(d.getMinutes())}`,
  };
}

/**
 * The two halves of a session folder's name: the company (or, without one, the title) and the session's
 * title (the role or topic). The second is left out when empty or the same as the first.
 *
 * @param session The session.
 * @returns The first and second halves (second may be '').
 * Called from: sessionFolderName(), sessionTitle(); tests
 */
export function sessionNameParts(session: Pick<Session, 'type' | 'company' | 'role'>): {
  first: string;
  second: string;
} {
  const company = sanitiseName(session.company);
  const title = sanitiseName(session.role);
  const first = company || title || `${SESSION_TYPE_WORDS[session.type]} call`;
  const second = company && title && title !== company ? title : '';
  return { first, second };
}

/**
 * The session's title as notifications and the email show it: "Acme – Backend Engineer".
 *
 * @param session The session.
 * @returns The title.
 * Called from: uploader.ts; tests
 */
export function sessionTitle(session: Pick<Session, 'type' | 'company' | 'role'>): string {
  const { first, second } = sessionNameParts(session);
  return second ? `${first} – ${second}` : first;
}

/**
 * The session folder's name: "<YYYY-MM-DD> <Company or title> – <Session title>".
 *
 * @param session The session.
 * @param at      The call's start (the folder is named after the first call it saves).
 * @returns The name.
 * Called from: uploader.ts; tests
 */
export function sessionFolderName(
  session: Pick<Session, 'type' | 'company' | 'role'>,
  at: number,
): string {
  return `${localStamp(at).date} ${sessionTitle(session)}`;
}

/**
 * A recording's name in Drive: "<YYYY-MM-DD HH.mm> Part N.mkv", or "… Part N stereo.webm" for its
 * stereo sound file.
 *
 * @param at        The call's start.
 * @param part      The part, from 1.
 * @param extension The file's extension without the dot ('mkv', 'webm').
 * @param stereo    True for the stereo sound file.
 * @returns The name.
 * Called from: uploader.ts; tests
 */
export function recordingDriveName(
  at: number,
  part: number,
  extension: string,
  stereo: boolean,
): string {
  const { date, time } = localStamp(at);
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
  return `${date} ${time} Part ${part}${stereo ? ' stereo' : ''}.${ext}`;
}

/** The call files saved in Transcripts. */
export type CallFileKind = 'transcript-txt' | 'transcript-pdf' | 'notes-pdf';

/**
 * A call file's name in Drive: "<YYYY-MM-DD HH.mm> Transcript.txt", "… Transcript.pdf" or
 * "… Notes.pdf".
 *
 * @param at   The call's start.
 * @param kind Which file.
 * @returns The name.
 * Called from: uploader.ts; tests
 */
export function callFileDriveName(at: number, kind: CallFileKind): string {
  const { date, time } = localStamp(at);
  const tail =
    kind === 'transcript-txt'
      ? 'Transcript.txt'
      : kind === 'transcript-pdf'
        ? 'Transcript.pdf'
        : 'Notes.pdf';
  return `${date} ${time} ${tail}`;
}
