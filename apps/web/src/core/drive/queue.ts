/**
 * File: apps/web/src/core/drive/queue.ts
 * Purpose: Whether a finished call goes to Google Drive (ADR-0072): it does when the account saves to
 *          Drive (connected or waiting to reconnect, and "Save calls to Google Drive" on); when the server
 *          cannot be asked (offline), the last answer this device saw decides. Tells this profile's other
 *          Kite windows about Drive (the uploader runs in one of them), Retry, and whether a call is live
 *          in any window (the call lock), which uploads wait for. ADR-0077: the after-call runner queues
 *          each call's own upload (core/live/afterCall.ts).
 * Used by: src/core/live/afterCall.ts, src/features/drive/* (the uploader, Settings)
 * Depends on: src/core/drive/api.ts, src/core/storage/{driveUploads,driveCallJobs}.ts,
 *             src/core/live/callLock.ts
 * Architecture: ADR-0072, ADR-0077
 */
import type { DriveStatusResponse } from '@kite/shared';
import { CALL_LOCK_NAME } from '../live/callLock';
import { requeueCallJobs } from '../storage/driveCallJobs';
import { requeueDriveJobs } from '../storage/driveUploads';
import { driveApi } from './api';

/** The BroadcastChannel this profile's Kite windows use for Drive news. */
export const DRIVE_CHANNEL = 'kite.drive';

/** Where the last known "this account saves to Drive" answer is kept on this device. */
export const DRIVE_ENABLED_KEY = 'kite.drive.saves';

/** What a Drive message says. */
export type DriveMessage = 'queued' | 'changed';

/**
 * Whether a status means calls should be queued.
 *
 * @param status The status.
 * @returns True when connected (or waiting to reconnect) and saving is on.
 * Called from: queueCallForDrive(), rememberDriveStatus(); tests
 */
export function savesToDrive(status: DriveStatusResponse): boolean {
  return status.configured && status.status !== 'not-connected' && status.saveEnabled;
}

/**
 * Remembers whether this account saves to Drive, for a call that ends offline.
 *
 * @param status The latest status.
 * Called from: queueCallForDrive(), features/drive (Settings, the uploader)
 */
export function rememberDriveStatus(status: DriveStatusResponse): void {
  try {
    localStorage.setItem(DRIVE_ENABLED_KEY, savesToDrive(status) ? '1' : '0');
  } catch {
    // Storage blocked: the next status read decides.
  }
}

/**
 * The last remembered answer.
 * @returns True when the account saved to Drive last time this device asked.
 * Called from: queueCallForDrive(); features/drive/useDrive.ts (useDriveSaves)
 */
export function rememberedSaves(): boolean {
  try {
    return localStorage.getItem(DRIVE_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Tells this profile's other Kite windows about Drive.
 *
 * @param message 'queued' (a call was queued) or 'changed' (the connection or settings changed).
 * Called from: queueCallForDrive(), features/drive (Settings)
 */
export function announceDrive(message: DriveMessage): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(DRIVE_CHANNEL);
  channel.postMessage(message);
  channel.close();
}

/**
 * Listens for Drive news from this profile's other windows.
 *
 * @param handler Called with each message.
 * @returns A function that stops listening.
 * Called from: features/drive/DriveUploader.tsx, features/drive/useDriveStatus.ts
 */
export function onDriveMessage(handler: (message: DriveMessage) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(DRIVE_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data === 'queued' || event.data === 'changed') handler(event.data);
  };
  return () => channel.close();
}

/**
 * Whether the account saves to Drive now: asks the server, or (offline) uses the last answer this device
 * saw. ADR-0077: a finished call is queued for Drive (its own job) by the after-call runner when it does.
 *
 * @returns True when calls should be queued.
 * Called from: core/live/afterCall.ts
 */
export async function driveSavesNow(): Promise<boolean> {
  try {
    const status = await driveApi().status();
    rememberDriveStatus(status);
    return savesToDrive(status);
  } catch {
    return rememberedSaves();
  }
}

/**
 * Whether a call is live in any Kite window of this profile: the call lock (core/live/callLock.ts) is
 * held. Where Web Locks are missing, no call is assumed (the desktop shell still pauses its own uploads).
 *
 * @returns True during a call.
 * Called from: the uploader's deps (features/drive/DriveUploader.tsx); tests
 */
export async function callIsLive(): Promise<boolean> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.query) return false;
  try {
    const snapshot = await locks.query();
    return (snapshot.held ?? []).some((lock) => lock.name === CALL_LOCK_NAME);
  } catch {
    return false;
  }
}

/**
 * Queues a session's upload again (Retry on a card, Meetings or a notice) and wakes the uploader.
 *
 * @param sessionId The session.
 * @returns When queued.
 * Called from: features/drive/DriveSessionStatus.tsx, features/drive/DriveNotices.tsx
 */
export async function retryDriveUpload(sessionId: string): Promise<void> {
  await requeueDriveJobs(sessionId);
  // ADR-0077: and the session's calls' own uploads.
  await requeueCallJobs(sessionId);
  announceDrive('queued');
}
