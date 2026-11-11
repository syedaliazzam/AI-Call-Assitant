/**
 * File: packages/shared/src/drive.ts
 * Purpose: Saving calls to Google Drive (desktop 1.6.0 and web, ADR-0072): the one OAuth scope Kite
 *          asks for, the shapes of the /api/google/* and /api/drive/* requests and replies, and the
 *          contract between the web app and the desktop shell for uploading a recording's file in
 *          resumable chunks straight to Google. Refresh tokens never appear here: they stay on the
 *          server, encrypted.
 * Used by: apps/web/src/server/google/*, apps/web/app/api/google/*, apps/web/app/api/drive/*,
 *          apps/web/src/core/drive/*, apps/web/src/platform/*, apps/desktop/src/drive/*,
 *          apps/desktop/src/preload.ts
 * Depends on: ./recording.ts (types only)
 * Architecture: docs/decisions/ADR-0072-google-drive-saving.md; architecture §7.2, §7.3, §8.1
 */
import type { RecordingTrack } from './recording';

/**
 * The only Google scope Kite requests: files and folders the app created or the person picked
 * (Picker). Never the whole Drive, Calendar or Gmail.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Google's MIME type for a folder. */
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Bytes per resumable upload chunk: 8 MiB, a multiple of 256 KiB as Google requires. Large enough
 * to keep requests few, small enough that a lost connection repeats little.
 */
export const DRIVE_CHUNK_BYTES = 8 * 1024 * 1024;

/** Google's chunk unit: every chunk but the last must be a multiple of it. */
export const DRIVE_CHUNK_UNIT = 256 * 1024;

/** The most "Also notify" addresses kept (Settings, or one session's override). */
export const MAX_ALSO_NOTIFY = 20;

/** The longest email address accepted, characters (RFC 5321's path limit). */
export const MAX_EMAIL_CHARS = 254;

/** The most files one "saved" email lists. */
export const MAX_SAVED_FILES = 40;

/** The longest session title or file name an email carries, characters. */
export const MAX_SAVED_NAME_CHARS = 200;

/** How many notifications Settings lists. */
export const DRIVE_NOTIFICATIONS_SHOWN = 20;

/**
 * The account's Google Drive connection:
 * - not-connected: never connected, or disconnected;
 * - connected: a refresh token is stored and worked last time;
 * - reconnect: Google refused the stored token (revoked, expired, or the project changed); uploads
 *   wait, queued, until the person connects again.
 */
export type DriveConnectionStatus = 'not-connected' | 'connected' | 'reconnect';

/** The Drive folder new sessions are saved in (chosen with Google Picker). */
export interface DriveFolder {
  /** The folder's Drive id. */
  id: string;
  /** Its name, as Drive had it when it was chosen. */
  name: string;
  /** The Shared Drive it is in, or null for My Drive. */
  driveId: string | null;
  /** Its address in Drive (https://drive.google.com/drive/folders/<id>). */
  url: string;
}

/** GET /api/google/status: everything Settings shows. */
export interface DriveStatusResponse {
  /** False when the deployment has no Google client (GOOGLE_CLIENT_ID / _SECRET not set). */
  configured: boolean;
  /** The connection. */
  status: DriveConnectionStatus;
  /** The chosen folder, or null until one is picked. */
  folder: DriveFolder | null;
  /** "Save calls to Google Drive" (on by default after connecting). */
  saveEnabled: boolean;
  /** The "saved" email. */
  email: {
    /** False until RESEND_API_KEY and NOTIFY_FROM_EMAIL are both set ("Email not set up"). */
    configured: boolean;
    /** The person's switch (on by default). */
    enabled: boolean;
    /** The team list ("Also notify"), lower-case. */
    alsoNotify: string[];
  };
}

/** GET /api/google/access-token: a short-lived token for Drive calls from this device. */
export interface DriveAccessTokenResponse {
  /** The OAuth access token (about an hour). Never stored by the page beyond its expiry. */
  accessToken: string;
  /** When it stops working (Unix ms), with a minute's margin taken off. */
  expiresAt: number;
}

/** GET /api/google/picker-config: what Google Picker needs besides the access token. */
export interface DrivePickerConfig {
  /** The Picker API key (restricted to the Picker API and Kite's addresses). */
  apiKey: string;
  /** The Google Cloud project number (setAppId), so the picked folder is shared with Kite. */
  appId: string;
}

/** POST /api/google/folder: the folder picked in Google Picker. */
export interface DriveFolderRequest {
  /** The picked folder's id (the server checks it with Drive). */
  folderId: string;
}

/** POST /api/google/settings: any of the person's switches and the team list. */
export interface DriveSettingsRequest {
  /** "Save calls to Google Drive". */
  saveEnabled?: boolean;
  /** "Email me when a call is saved". */
  emailEnabled?: boolean;
  /** The team list ("Also notify"); each a valid address, at most MAX_ALSO_NOTIFY. */
  alsoNotify?: string[];
}

/** Which session subfolder a saved file is in. */
export type DriveSubfolder = 'Recordings' | 'Transcripts';

/** One file a session's upload saved, as the email lists it (name only, never content). */
export interface DriveSavedFile {
  /** The file's name in Drive. */
  name: string;
  /** Its subfolder. */
  folder: DriveSubfolder;
}

/**
 * POST /api/drive/notify: a session's uploads all finished. Only these fields exist, so an email can
 * never carry transcript, notes, answer or document text.
 */
export interface DriveNotifyRequest {
  /** The session (a UUID); one email per session, ever. */
  sessionId: string;
  /** The session's title, as on its card. */
  title: string;
  /** When the call started (Unix ms). */
  callStartedAt: number;
  /** How long the call lasted, ms (0 when unknown). */
  durationMs: number;
  /** Which files were saved. */
  files: DriveSavedFile[];
  /** The session folder in Drive. */
  folderUrl: string;
  /** The person's own time zone (IANA name), for the email's date. */
  timeZone: string;
  /** This session's own "Also notify" list, replacing the Settings list; null to use Settings. */
  alsoNotify: string[] | null;
}

/**
 * What became of a session's "saved" email:
 * - sent: Resend accepted it;
 * - failed: Resend refused it or could not be reached (Retry in Settings);
 * - off: the person's email switch was off;
 * - not-set-up: Resend is not configured on this deployment;
 * - pending: being sent now.
 */
export type DriveNotificationStatus = 'sent' | 'failed' | 'off' | 'not-set-up' | 'pending';

/** POST /api/drive/notify's reply. */
export interface DriveNotifyResponse {
  /** The email's state (the first request's: a repeat never sends again). */
  status: DriveNotificationStatus;
}

/** One row of Settings → "Recent notifications". */
export interface DriveNotificationItem {
  /** The session. */
  sessionId: string;
  /** The session's title. */
  title: string;
  /** The email's state. */
  status: DriveNotificationStatus;
  /** When the session's uploads finished (Unix ms). */
  createdAt: number;
  /** When the email was accepted (Unix ms), or null. */
  sentAt: number | null;
  /** The session folder in Drive. */
  folderUrl: string;
  /** How many addresses the email went (or would go) to. */
  recipients: number;
}

/** GET /api/drive/notifications. */
export interface DriveNotificationsResponse {
  /** The latest DRIVE_NOTIFICATIONS_SHOWN, newest first. */
  items: DriveNotificationItem[];
}

/** POST /api/drive/notifications: send a failed email again. */
export interface DriveRetryRequest {
  /** The session whose email failed. */
  sessionId: string;
}

/**
 * The desktop shell's part (1.6.0): upload one of this computer's recording files to a resumable
 * upload session the page opened. The page names the recording and the upload address; the shell
 * reads the file from its own Recordings index only and sends it nowhere but Google's upload host.
 */
export interface DriveUploadRequest {
  /** The recording (its id in the shell's index). */
  recordingId: string;
  /** Its main file or its stereo sound file. */
  track: RecordingTrack;
  /** The resumable session's address (https://www.googleapis.com/upload/drive/v3/files?…upload_id=…). */
  uploadUrl: string;
  /** A short-lived access token for the requests. */
  accessToken: string;
}

/**
 * How an upload ended:
 * - done: the file is in Drive (fileId);
 * - paused: a call started, so the shell stopped between chunks; offset says how far it got;
 * - auth: Google refused the token (expired); the page gets a new one and calls again;
 * - expired: the upload session is gone (a week old, or cancelled); the page opens a new one;
 * - missing: the file is no longer on this computer;
 * - failed: anything else; retryable says whether trying again later may work.
 */
export type DriveUploadResult =
  | {
      /** The file is in Drive. */
      status: 'done';
      /** Its Drive id. */
      fileId: string;
      /** Its size. */
      bytes: number;
    }
  | {
      /** Stopped for a call ('paused') or for a new token ('auth'). */
      status: 'paused' | 'auth';
      /** Bytes Google has. */
      offset: number;
      /** The file's size. */
      bytes: number;
    }
  | {
      /** The upload session is gone, or the file is no longer on this computer. */
      status: 'expired' | 'missing';
    }
  | {
      /** Anything else. */
      status: 'failed';
      /** True when trying again later may work (network, Google's server errors). */
      retryable: boolean;
      /** A short code for the log and the page ('network', 'http-403', 'read'), never content. */
      reason: string;
    };

/** Progress of a shell upload, sent to the page that started it. */
export interface DriveUploadProgress {
  /** The recording. */
  recordingId: string;
  /** Which of its files. */
  track: RecordingTrack;
  /** Bytes in Drive so far. */
  sent: number;
  /** The file's size. */
  total: number;
}

/** A native notification the page asks the shell to show (1.6.0). */
export interface DesktopNotice {
  /** The first line (for example "Recording and transcript saved"). */
  title: string;
  /** The second line (for example the session's title). */
  body: string;
  /** Opened in the system browser when the notification is clicked: a Google Drive address only. */
  url?: string;
}

/**
 * A Drive folder's address.
 * @param folderId The folder's id.
 * @returns https://drive.google.com/drive/folders/<id>.
 * Called from: apps/web/src/server/google/*, apps/web/src/core/drive/*
 */
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

/**
 * Whether an address is a Google Drive page (what a notification may open).
 * @param url The address.
 * @returns True for https://drive.google.com/….
 * Called from: apps/desktop/src/drive/notice.ts; apps/web/src/core/drive/*; tests
 */
export function isDriveLink(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && parsed.hostname === 'drive.google.com' && !parsed.port;
}

/**
 * Whether an address is a Drive resumable upload session (the only place the shell sends a file).
 * @param url The address.
 * @returns True for https://www.googleapis.com/upload/drive/v3/files?…upload_id=….
 * Called from: apps/desktop/src/drive/upload.ts; tests
 */
export function isDriveUploadUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'www.googleapis.com' &&
    !parsed.port &&
    parsed.pathname === '/upload/drive/v3/files' &&
    !!parsed.searchParams.get('upload_id')
  );
}

/**
 * Reads the next offset from a resumable upload's 308 reply: its Range header "bytes=0-N" means N + 1
 * bytes are stored; no header means none are.
 * @param range The Range header, or null.
 * @returns The bytes Google has.
 * Called from: apps/desktop/src/drive/upload.ts, apps/web/src/core/drive/google.ts; tests
 */
export function nextOffsetFromRange(range: string | null): number {
  const match = range ? /^bytes=0-(\d+)$/.exec(range.trim()) : null;
  return match ? Number(match[1]) + 1 : 0;
}

/**
 * The first line of a "saved" notification and email, from what was saved: "Recording and transcript
 * saved", "Recording saved", "Transcript saved" or "Files saved".
 * @param files The saved files.
 * @returns The line.
 * Called from: apps/web/src/server/google/email.ts, apps/web/src/core/drive/uploader.ts; tests
 */
export function savedHeadline(files: readonly DriveSavedFile[]): string {
  const recording = files.some((file) => file.folder === 'Recordings');
  const transcript = files.some((file) => /Transcript\.(txt|pdf)$/.test(file.name));
  if (recording && transcript) return 'Recording and transcript saved';
  if (recording) return 'Recording saved';
  if (transcript) return 'Transcript saved';
  return 'Files saved';
}
