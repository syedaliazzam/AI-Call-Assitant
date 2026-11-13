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

/** The most files (or recording parts) one report or one session record carries. */
export const MAX_SAVED_FILES = 200;

/** The longest session title or file name an email carries, characters. */
export const MAX_SAVED_NAME_CHARS = 200;

/** How many notifications Settings lists. */
export const DRIVE_NOTIFICATIONS_SHOWN = 20;

/**
 * The account's Google Drive connection:
 * - not-connected: never connected, or disconnected;
 * (ADR-0074: the COMPANY account's connection, made by an admin; people no longer connect.)
 * - connected: a refresh token is stored and worked last time;
 * - reconnect: Google refused the stored token (revoked, expired, or the project changed); uploads
 *   wait, queued, until an admin reconnects.
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
  /** The company connection (ADR-0074). */
  status: DriveConnectionStatus;
  /** The company folder, or null until an admin picks one. */
  folder: DriveFolder | null;
  /** True for an admin (who connects the company account and picks the folder). */
  admin: boolean;
  /** The company Google account's address: admins only (null for everyone else, or unknown). */
  account: string | null;
  /** The person's "Save calls to Google Drive" (on by default). */
  saveEnabled: boolean;
  /** The "saved" email. */
  email: {
    /** False until SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and NOTIFY_FROM_EMAIL are set ("Email not set up"). */
    configured: boolean;
    /** The person's switch (on by default). */
    enabled: boolean;
    /** The team list ("Also notify"), lower-case. */
    alsoNotify: string[];
  };
}

/**
 * GET /api/google/picker-config (admins only): what Google Picker needs. ADR-0074: the Picker's token is
 * NOT Kite's: the admin's page asks Google Identity Services for its own short-lived one (clientId,
 * hint = account), holds it in memory for the Picker only, and never sends it anywhere.
 */
export interface DrivePickerConfig {
  /** The Picker API key (restricted to the Picker API and Kite's addresses). */
  apiKey: string;
  /** The Google Cloud project number (setAppId), so the picked folder is shared with Kite. */
  appId: string;
  /** The OAuth client id (public), for Google Identity Services' token popup. */
  clientId: string;
  /** The company account's address, to preselect it in Google's popup; null when unknown. */
  account: string | null;
}

/** POST /api/drive/session-folder (ADR-0074): the server finds or makes a session's folders. */
export interface DriveSessionFolderRequest {
  /** The session (a UUID). */
  sessionId: string;
  /** The session folder's name, used only when it is made ("<date> <Company> – <title>"). */
  name: string;
}

/** The session's folders. */
export interface DriveSessionFolderResponse {
  /** The session folder. */
  folderId: string;
  /** Its Recordings subfolder. */
  recordingsId: string;
  /** Its Transcripts subfolder. */
  transcriptsId: string;
}

/** POST /api/drive/uploads (ADR-0074): one recording file to upload. */
export interface DriveUploadStartRequest {
  /** The session. */
  sessionId: string;
  /** The file's stable key ('rec:<recording id>:main' or ':stereo'). */
  key: string;
  /** Its name in Drive. */
  name: string;
  /** Its type ('video/x-matroska', 'video/webm' or 'audio/webm'). */
  mimeType: string;
  /** Its size in bytes. */
  bytes: number;
}

/**
 * The reply: the file is already in Drive, or an upload was started. The client gets ONLY that upload's
 * session address (valid for that one file) and a ticket the server signed for it; never a token.
 */
export type DriveUploadStartResponse =
  | {
      /** Already in Drive (saved before this device lost track of it). */
      status: 'exists';
      /** Its Drive id. */
      fileId: string;
    }
  | {
      /** Started. */
      status: 'started';
      /** The resumable session's address. */
      uploadUrl: string;
      /** The server's ticket for this upload (for offset and complete). */
      ticket: string;
    };

/** POST /api/drive/uploads/offset: where an upload got to (a restart or a resume). */
export interface DriveUploadOffsetRequest {
  /** The session address. */
  uploadUrl: string;
  /** Its ticket. */
  ticket: string;
}

/** The reply: how far, finished (with the file), or gone (start again). */
export type DriveUploadOffsetResponse =
  | {
      /** Partly sent. */
      state: 'partial';
      /** Bytes Google has. */
      offset: number;
    }
  | {
      /** Finished. */
      state: 'done';
      /** The file. */
      fileId: string;
    }
  | {
      /** The session is gone (a week old, or cancelled). */
      state: 'expired';
    };

/** POST /api/drive/uploads/complete: the client says it finished; the server verifies the file. */
export interface DriveUploadCompleteRequest {
  /** The session address. */
  uploadUrl: string;
  /** Its ticket. */
  ticket: string;
  /** The Drive id Google answered with. */
  fileId: string;
  /** The whole file's MD5 (hex), when the client computed it (desktop 1.6.2). */
  md5?: string;
}

/** The reply (and the reply of POST /api/drive/files): the verified file. */
export interface DriveVerifiedFile {
  /** Its Drive id, checked by the server with the company token (tag, size, MD5). */
  fileId: string;
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

/** What a saved file is, for its label in the email ("Recording Part 1", "Stereo audio", …). */
export type DriveFileKind =
  'recording' | 'stereo' | 'transcript-txt' | 'transcript-pdf' | 'notes-pdf';

/** One file a session's upload saved, as the email lists it (name and Drive id only, never content). */
export interface DriveSavedFile {
  /** The file's name in Drive. */
  name: string;
  /** Its subfolder. */
  folder: DriveSubfolder;
  /**
   * Its stable key ('rec:<recording>:main', 'call:<start>:notes-pdf', …), so reports from several
   * devices and retries merge instead of repeating. Absent in records made before 1.6.0's release.
   */
  key?: string;
  /** Its Drive id, for a direct link. Absent in older records. */
  fileId?: string;
  /** What it is. Absent in older records. */
  kind?: DriveFileKind;
  /** The recording part (recordings and stereo files). */
  part?: number;
}

/** A recording part the account knows the session has (from any computer), which the email waits for. */
export interface DriveExpectedRecording {
  /** The recording's id. */
  id: string;
  /** Its part, from 1. */
  part: number;
  /** True when it has a stereo sound file too (also waited for). */
  stereo: boolean;
  /**
   * ADR-0077: the name of the computer that holds its files ("Saved on <name>"), for the "Recording not
   * uploaded: open Paramount AI on <name>" email. Absent from older apps.
   */
  deviceName?: string;
}

/**
 * ADR-0077: the email rule a report asks for. 'two-step' (calls ended from 13 Nov 2026 on): email 1
 * "Call saved" once the call's transcript and notes are in Drive, then email 2 "Recording saved" when its
 * recording is (or "Recording not uploaded" after 24 hours). Absent: the older one email per call.
 */
export type DriveEmailRule = 'two-step';

/**
 * POST /api/drive/notify: a device's report of what it saved for ONE CALL of a session (when its uploads
 * finish, or stop with some files saved). ADR-0073: each call of a session has its own email (a session
 * can be started again after it ended, each start a new call). The server merges every device's reports
 * per call and sends that call's ONE email when every expected file is in (or after 24 hours, saying the
 * recording upload is pending). Only these
 * fields exist, so an email can
 * never carry transcript, notes, answer or document text.
 */
export interface DriveNotifyRequest {
  /** The session (a UUID). */
  sessionId: string;
  /** The session's title, as on its card. */
  title: string;
  /** When this call started (Unix ms): with the session, it names the call's one email (ADR-0073). */
  callStartedAt: number;
  /** How long this call lasted, ms (0 when unknown). */
  durationMs: number;
  /** Which of this call's files were saved. */
  files: DriveSavedFile[];
  /** The session folder in Drive. */
  folderUrl: string;
  /** The person's own time zone (IANA name), for the email's date. */
  timeZone: string;
  /** This session's own "Also notify" list, replacing the Settings list; null to use Settings. */
  alsoNotify: string[] | null;
  /** Every recording part the account knows this call has (this computer's and other computers'). */
  expectedRecordings: DriveExpectedRecording[];
  /** Recordings that can never be uploaded (their files were deleted): no longer waited for. */
  goneRecordings: string[];
  /**
   * True for a session that must not be emailed automatically (saved before the combined email, or with
   * "Upload to Drive"): a new record waits for "Send email" in Settings. Ignored with emailRule.
   */
  manualOnly: boolean;
  /** ADR-0077: the email rule (see DriveEmailRule); absent for the older single email. */
  emailRule?: DriveEmailRule;
  /**
   * ADR-0077 (two-step rule): true once every Transcripts file of the call (transcript TXT and PDF, notes
   * PDF) is in Drive, or there is none to save. Email 1 goes when it is true.
   */
  callFilesSaved?: boolean;
  /** ADR-0077: the session's Recordings subfolder in Drive, linked in email 1 while a recording uploads. */
  recordingsFolderUrl?: string;
}

/**
 * What became of a session's "saved" email:
 * - sent: the mail server accepted it;
 * - failed: the mail server refused it or could not be reached (Retry in Settings);
 * - off: the person's email switch was off;
 * - not-set-up: email (SMTP) was not configured when the session was complete ("Send email" in Settings);
 * - pending: being sent now;
 * - collecting: files are still arriving (a recording from the desktop app, for example).
 */
export type DriveNotificationStatus =
  'sent' | 'failed' | 'off' | 'not-set-up' | 'pending' | 'collecting';

/** POST /api/drive/notify's reply. */
export interface DriveNotifyResponse {
  /** The email's state (the first request's: a repeat never sends again). */
  status: DriveNotificationStatus;
}

/** One row of Settings → "Recent notifications": one call's email (ADR-0073). */
export interface DriveNotificationItem {
  /** The session. */
  sessionId: string;
  /**
   * Which of the session's emails (ADR-0073): null for the session's first record (its first call, or a
   * whole session saved before ADR-0073), else the start (Unix ms) of the later call it is about.
   */
  call: number | null;
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
  /** How many files are in Drive. */
  files: number;
  /** True when the email was (or will be) sent without the recording, whose upload had not finished. */
  recordingPending: boolean;
  /**
   * ADR-0077: which email of the call: 'call' ("Call saved", or the older single email) or 'recording'
   * ("Recording saved", or "Recording not uploaded" after 24 hours). Absent means 'call'.
   */
  kind?: 'call' | 'recording';
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
  /** Which of its emails (DriveNotificationItem.call); absent or null for the first. */
  call?: number | null;
  /** ADR-0077: true for the call's "Recording saved" email (DriveNotificationItem.kind 'recording'). */
  recording?: boolean;
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
  /**
   * 1.6.0 and 1.6.1 required a token here. ADR-0074: never sent any more; a 1.6.2 shell uploads with the
   * session address alone (no Authorization header). Older shells refuse a request without it, so the
   * page does not send them recordings (they wait for the update).
   */
  accessToken?: string;
  /** 1.6.2: the offset Google already has, from the server (the shell starts there without asking). */
  startOffset?: number;
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
      /** 1.6.2: the whole file's MD5 (hex), for the server's check. */
      md5?: string;
    }
  | {
      /** Stopped for a call ('paused') or for a new token ('auth', 1.6.0 and 1.6.1 only). */
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

/** POST /api/drive/test-email: a test email to the signed-in person only. */
export interface DriveTestEmailResponse {
  /** 'sent' (the server accepted it) or 'failed'. */
  status: 'sent' | 'failed';
  /**
   * Why it failed: 'rejected' (the server refused it: the account, password or sender) or 'unreachable'
   * (host, port or network). Absent when sent.
   */
  reason?: 'rejected' | 'unreachable';
}
