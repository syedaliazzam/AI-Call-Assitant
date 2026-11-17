/**
 * File: apps/web/src/features/meetings/FilesTab.tsx
 * Purpose: The Meetings library's Files tab (ADR-0096): the call's files. The transcript PDF and the notes
 *          PDF are made on this device from the synced call data (the same files Google Drive gets, with the
 *          same names) and can be downloaded at once, before any upload; each also links to its copy in
 *          Drive once saved. Each recording part shows its size, length and computer, with "Show in folder"
 *          and "Save as…" on the computer that holds it (the desktop app) and its Drive link once uploaded.
 *          Then "Open folder in Drive ↗" and the session's Drive upload line (upload, retry).
 * Used by: CallPane.tsx
 * Depends on: lucide-react, @kite/shared (driveFolderUrl), src/core/drive/callFiles.ts (buildCallViewFiles),
 *             src/core/drive/names.ts, src/core/review/downloadTranscript.ts (downloadFile),
 *             src/core/recording/meetings.ts (formatBytes, formatDuration), src/platform (RecordingHost),
 *             src/features/drive/DriveSessionStatus.tsx, ./DriveAccessNote.tsx, ./useCallDrive.ts, src/ui
 * Architecture: docs/decisions/ADR-0096-meetings-library.md; ADR-0080 (the files Drive keeps)
 *
 * File names and sizes only; nothing is logged.
 */
'use client';

import { driveFolderUrl, type DriveCallFileLink } from '@kite/shared';
import { Download, ExternalLink, FileText, FolderOpen, Save, Sparkles, Video } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { buildCallViewFiles } from '@/core/drive/callFiles';
import { callFileDriveName, sessionTitle, type CallFileKind } from '@/core/drive/names';
import { formatBytes, formatDuration } from '@/core/recording/meetings';
import type { CallView } from '@/core/review/calls';
import { downloadFile } from '@/core/review/downloadTranscript';
import type { Session } from '@/core/storage/types';
import { DriveSessionStatus } from '@/features/drive/DriveSessionStatus';
import type { RecordingHost } from '@/platform/types';
import { Button, buttonClasses } from '@/ui/Button';
import { DriveAccessNote } from './DriveAccessNote';
import type { CallDriveState } from './useCallDrive';

/** Props for FilesTab. */
export interface FilesTabProps {
  /** The session. */
  session: Session;
  /** The call. */
  call: CallView;
  /** The signed-in account's display name (on the user's turns in the transcript PDF). */
  accountName: string | null;
  /** The desktop app's recording host; null in a browser. */
  host: RecordingHost | null;
  /** The desktop app: ids of the recordings whose files are on this computer; null in a browser. */
  localIds: ReadonlySet<string> | null;
  /** The call's Drive side. */
  drive: CallDriveState;
}

/**
 * A "<name> in Drive ↗" link.
 *
 * @param props.file The saved file.
 * @returns The link.
 * Rendered by: FilesTab
 */
function DriveLink({ file }: { file: DriveCallFileLink }) {
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses('secondary', 'sm')}
    >
      Open in Drive
      <ExternalLink aria-hidden="true" size={14} strokeWidth={1.75} />
    </a>
  );
}

/**
 * One file row.
 *
 * @param props.icon     Its icon.
 * @param props.title    Its name.
 * @param props.detail   A line under it.
 * @param props.children Its buttons.
 * @returns The row.
 * Rendered by: FilesTab
 */
function FileRow({
  icon,
  title,
  detail,
  children,
}: {
  /** Its icon. */
  icon: ReactNode;
  /** Its name. */
  title: string;
  /** A line under it. */
  detail: string;
  /** Its buttons. */
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 text-ui-muted">{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-ui-heading">{title}</p>
          <p className="text-[12px] text-ui-muted">{detail}</p>
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap gap-2">{children}</div>}
    </li>
  );
}

/**
 * The Files tab.
 *
 * @param props See FilesTabProps.
 * @returns The tab's content.
 * Rendered by: CallPane.tsx
 */
export function FilesTab({ session, call, accountName, host, localIds, drive }: FilesTabProps) {
  const [message, setMessage] = useState<string | null>(null);
  const links = drive.kind === 'ready' ? drive.drive.files : [];
  const linkOf = (kind: DriveCallFileLink['kind'], part = 1) =>
    links.find((file) => file.kind === kind && file.part === part);
  const hasTranscript =
    session.saveTranscript && (call.lines.length > 0 || call.answers.length > 0);
  const folderUrl =
    drive.kind === 'ready' && drive.drive.folderUrl
      ? drive.drive.folderUrl
      : call.record?.drive.folderId
        ? driveFolderUrl(call.record.drive.folderId)
        : null;
  const icon = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;
  const parts = [...call.recordings].sort((a, b) => a.part - b.part);

  /**
   * Makes one of the call's PDFs on this device and downloads it, named as in Drive.
   * @param kind The transcript or the notes.
   */
  async function download(kind: CallFileKind) {
    setMessage(null);
    const files = await buildCallViewFiles(session, call, sessionTitle(session), accountName).catch(
      () => [],
    );
    const file = files.find((one) => one.kind === kind);
    if (!file) {
      setMessage('The file could not be made. Reload the page and try again.');
      return;
    }
    downloadFile(callFileDriveName(call.startedAt, kind), 'application/pdf', file.blob);
  }

  return (
    <div className="flex flex-col gap-4">
      <ul
        aria-label="Files of this call"
        className="flex flex-col divide-y divide-ui-border rounded-card border border-ui-border bg-ui-surface shadow-card"
      >
        <FileRow
          icon={<FileText {...icon} />}
          title="Transcript (PDF)"
          detail={
            hasTranscript
              ? callFileDriveName(call.startedAt, 'transcript-pdf')
              : 'Not saved ("Save transcript" was off, or nothing was heard)'
          }
        >
          {hasTranscript && (
            <Button size="sm" variant="secondary" onClick={() => void download('transcript-pdf')}>
              <Download aria-hidden="true" size={14} strokeWidth={1.75} />
              Download
            </Button>
          )}
          {linkOf('transcript-pdf') && <DriveLink file={linkOf('transcript-pdf')!} />}
        </FileRow>
        <FileRow
          icon={<Sparkles {...icon} />}
          title="AI notes (PDF)"
          detail={call.notes ? callFileDriveName(call.startedAt, 'notes-pdf') : 'No notes yet'}
        >
          {call.notes && (
            <Button size="sm" variant="secondary" onClick={() => void download('notes-pdf')}>
              <Download aria-hidden="true" size={14} strokeWidth={1.75} />
              Download
            </Button>
          )}
          {linkOf('notes-pdf') && <DriveLink file={linkOf('notes-pdf')!} />}
        </FileRow>
        {parts.length === 0 ? (
          <FileRow icon={<Video {...icon} />} title="Recording" detail="Not recorded" />
        ) : (
          parts.map((part) => {
            const here = localIds?.has(part.id) === true;
            const link = linkOf('recording', part.part);
            return (
              <FileRow
                key={part.id}
                icon={<Video {...icon} />}
                title={parts.length > 1 ? `Recording, part ${part.part}` : 'Recording'}
                detail={[
                  part.kind === 'screen' ? 'Screen and sound' : 'Sound only',
                  formatDuration(part.durationMs),
                  ...(part.bytes > 0 ? [formatBytes(part.bytes)] : []),
                  part.deviceName ? `Saved on ${part.deviceName}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {here && host && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void host.showInFolder(part.id).catch(() => undefined)}
                    >
                      <FolderOpen aria-hidden="true" size={14} strokeWidth={1.75} />
                      Show in folder
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void host
                          .saveAs(part.id)
                          .then((result) =>
                            setMessage(result === 'saved' ? 'A copy was saved.' : null),
                          )
                          .catch(() => setMessage('The copy could not be saved.'))
                      }
                    >
                      <Save aria-hidden="true" size={14} strokeWidth={1.75} />
                      Save as…
                    </Button>
                  </>
                )}
                {link && <DriveLink file={link} />}
              </FileRow>
            );
          })
        )}
      </ul>

      {message && (
        <p role="status" className="text-[13px] text-ui-muted">
          {message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {folderUrl ? (
          <a
            href={folderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClasses('secondary', 'md')} w-fit`}
          >
            Open folder in Drive
            <ExternalLink aria-hidden="true" size={16} strokeWidth={1.75} />
          </a>
        ) : (
          drive.kind !== 'loading' && (
            <p className="text-[13px] text-ui-muted">This call is not in Google Drive yet.</p>
          )
        )}
        {drive.kind === 'ready' && <DriveAccessNote access={drive.drive.access} />}
        {/* The session's upload from this device (ADR-0072): progress, Retry, or "Upload to Drive". */}
        <DriveSessionStatus sessionId={session.id} canUpload />
      </div>
    </div>
  );
}
