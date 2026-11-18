/**
 * Tests for apps/web/src/platform/drive.ts (desktop 1.6.0, ADR-0072): the desktop Drive host passes only
 * its own upload's progress to its caller and stops listening afterwards, and is absent in a shell before
 * 1.6.0 (no Drive methods on the bridge). 1.7.2 (ADR-0106): the Drive queue report goes to a shell that has
 * it, and is absent on an older one. All values are invented.
 */
import type { KiteDesktopApi } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { desktopDriveHost } from '@/platform/drive';

describe('desktopDriveHost', () => {
  it('passes only its own upload progress, and is absent without the 1.6.0 methods', async () => {
    const listeners: ((p: {
      recordingId: string;
      track: 'main' | 'stereo';
      sent: number;
      total: number;
    }) => void)[] = [];
    const bridge = {
      driveUpload: async () => {
        for (const listener of listeners) {
          listener({ recordingId: 'other', track: 'main', sent: 1, total: 2 });
          listener({ recordingId: 'r1', track: 'main', sent: 2, total: 2 });
        }
        return { status: 'done', fileId: 'F', bytes: 2 };
      },
      onDriveUploadProgress: (handler: (typeof listeners)[number]) => {
        listeners.push(handler);
        return () => listeners.splice(listeners.indexOf(handler), 1);
      },
      showNotice: async () => true,
    } as unknown as KiteDesktopApi;
    const host = desktopDriveHost(bridge)!;
    const seen: string[] = [];
    await host.upload(
      { recordingId: 'r1', track: 'main', uploadUrl: 'u', accessToken: 't' },
      (progress) => seen.push(progress.recordingId),
    );
    expect(seen).toEqual(['r1']);
    expect(listeners).toHaveLength(0);
    expect(desktopDriveHost({ version: '1.5.2', os: 'windows' })).toBeNull();
  });

  it('1.7.2: passes the Drive queue report on, only when the shell has it', () => {
    const base = {
      driveUpload: async () => ({ status: 'missing' }),
      onDriveUploadProgress: () => () => undefined,
      showNotice: async () => true,
    };
    const reports: unknown[] = [];
    const host = desktopDriveHost({
      ...base,
      reportDriveQueue: (report: unknown) => reports.push(report),
    } as unknown as KiteDesktopApi)!;
    host.reportQueue!({ calls: 1, recordings: 1, sent: 5, total: 10 });
    expect(reports).toEqual([{ calls: 1, recordings: 1, sent: 5, total: 10 }]);
    expect(desktopDriveHost(base as unknown as KiteDesktopApi)!.reportQueue).toBeUndefined();
  });
});
