/**
 * File: apps/web/src/features/meetings/RecordingPlayer.tsx
 * Purpose: The desktop app's player window (1.5.0, ADR-0068): one recording part's video (or sound) from
 *          this computer, with the session's saved transcript beside it (a click on a line jumps the
 *          video there; the line being spoken is highlighted), the meeting's other parts, and Save as…,
 *          Open folder and Delete (to the Recycle Bin; the record leaves Meetings too). On a computer that
 *          does not have the file it says where the recording is saved.
 * Used by: app/player/[id]/page.tsx
 * Depends on: @kite/shared (recordingFileUrl), src/core/storage (recordings, sessions, utterances),
 *             src/core/recording/meetings.ts, src/core/sync/client.ts, src/core/transcript/turns.ts,
 *             src/features/shell/AccountName.tsx, src/platform, src/ui/Button.tsx
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 * Transcript words are shown on screen only; nothing is logged.
 */
'use client';

import { recordingFileUrl, type LocalRecording } from '@kite/shared';
import { FolderOpen, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  currentLineIndex,
  formatBytes,
  formatDuration,
  linesInPart,
} from '@/core/recording/meetings';
import { deleteRecording, getRecording, listMeetingParts } from '@/core/storage/recordings';
import { getSession } from '@/core/storage/sessions';
import type { Session, StoredRecording, StoredUtterance } from '@/core/storage/types';
import { listUtterances } from '@/core/storage/utterances';
import { flushAccountSync, pullAccountSync } from '@/core/sync/client';
import { speakerNames } from '@/core/transcript/turns';
import { useAccountName } from '@/features/shell/AccountName';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';

/** A page state with nothing more to it. */
interface PlainLoad {
  /** Reading the records; neither the account nor this computer has it; or it was just deleted. */
  kind: 'loading' | 'missing' | 'deleted';
}

/** The record is in the account, but the file is on another computer (or still being written). */
interface ElsewhereLoad {
  /** Which state. */
  kind: 'elsewhere';
  /** The account's record (for "Saved on <name>"), or null. */
  record: StoredRecording | null;
}

/** Ready to play. */
interface ReadyLoad {
  /** Which state. */
  kind: 'ready';
  /** The part's record (or one made from the shell's entry when the account has none). */
  record: StoredRecording;
  /** The shell's entry (the file on this computer). */
  local: LocalRecording;
  /** The meeting's parts, first first. */
  parts: StoredRecording[];
  /** The session, or null when this device does not have it. */
  session: Session | null;
  /** The session's saved transcript lines. */
  lines: StoredUtterance[];
}

/** Where the page stands. */
type Load = PlainLoad | ElsewhereLoad | ReadyLoad;

/**
 * m:ss of a point in the video.
 * @param seconds The point.
 * @returns For example "4:07".
 */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The player.
 * @param props.recordingId The part to play.
 * @returns The page.
 * Rendered by: app/player/[id]/page.tsx
 */
export function RecordingPlayer({ recordingId }: { recordingId: string }) {
  const host = getPlatform().recording;
  const accountName = useAccountName();
  const [id, setId] = useState(recordingId);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [now, setNow] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      let record = await getRecording(id);
      if (!record) {
        // Opened from a link before this app pulled the account's latest records.
        await pullAccountSync().catch(() => undefined);
        record = await getRecording(id);
      }
      const local = host ? ((await host.list()).find((entry) => entry.id === id) ?? null) : null;
      if (!live) return;
      if (!local || local.status === 'missing' || local.status === 'recording') {
        setLoad(record || local ? { kind: 'elsewhere', record } : { kind: 'missing' });
        return;
      }
      const base: StoredRecording = record ?? {
        // The file is here but its record is not in the account (for example its session was
        // deleted): it still plays, from what the shell knows.
        ...local,
        status: local.status,
        deviceId: '',
        deviceName: '',
        updatedAt: 0,
      };
      const [parts, session, lines] = await Promise.all([
        listMeetingParts(base.meetingId),
        getSession(base.sessionId),
        listUtterances(base.sessionId).catch(() => []),
      ]);
      if (!live) return;
      setNow(Date.now());
      setLoad({ kind: 'ready', record: base, local, parts, session, lines });
    })().catch(() => {
      if (live) setLoad({ kind: 'missing' });
    });
    return () => {
      live = false;
    };
  }, [id, host]);

  const ready = load.kind === 'ready' ? load : null;
  const partLines = useMemo(
    () => (ready ? linesInPart(ready.lines, ready.record, now) : []),
    [ready, now],
  );
  const names = speakerNames(ready?.session, accountName);
  const [current, setCurrent] = useState(-1);

  if (load.kind === 'loading') {
    return <p className="p-6 text-[15px] text-ui-muted">Opening the recording…</p>;
  }
  if (load.kind === 'deleted') {
    return (
      <p role="status" className="p-6 text-[15px] text-ui-text">
        The recording was moved to the Recycle Bin and removed from Meetings.
      </p>
    );
  }
  if (load.kind === 'missing' || load.kind === 'elsewhere') {
    const where = load.kind === 'elsewhere' ? load.record?.deviceName : undefined;
    return (
      <p role="status" className="p-6 text-[15px] text-ui-text">
        {where
          ? `This recording is saved on ${where}. Open it in Paramount AI on that computer.`
          : 'This recording is not on this computer.'}
      </p>
    );
  }

  // Every other state returned above; this also tells TypeScript.
  if (load.kind !== 'ready') return null;
  const { record, local, parts } = load;
  const video = record.kind === 'screen';

  /** Deletes this part: files to the Recycle Bin, then its record. */
  const remove = async () => {
    setConfirmDelete(false);
    if (!host || !(await host.remove(record.id).catch(() => false))) {
      setMessage(
        'The recording could not be deleted. Close any app that has it open, then try again.',
      );
      return;
    }
    await deleteRecording(record.id).catch(() => undefined);
    await flushAccountSync().catch(() => undefined);
    const next = parts.find((part) => part.id !== record.id);
    if (next) setId(next.id);
    else setLoad({ kind: 'deleted' });
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-ui-bg text-ui-text">
      <header className="flex flex-wrap items-center gap-3 border-b border-ui-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-[16px] font-semibold text-ui-heading">
            {[load.session?.company, load.session?.role].filter(Boolean).join(' · ') || 'Recording'}
          </h1>
          <p className="text-[13px] text-ui-muted">
            {new Date(record.startedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            · {formatDuration(local.durationMs || record.durationMs)} · {formatBytes(local.bytes)}
            {local.status === 'recovered' ? ' · recovered after the app stopped' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void host
                ?.saveAs(record.id)
                .then((result) => setMessage(result === 'saved' ? 'A copy was saved.' : null))
                .catch(() => setMessage('The copy could not be saved.'))
            }
          >
            <Save aria-hidden="true" size={16} strokeWidth={1.75} />
            Save as…
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void host?.showInFolder(record.id).catch(() => undefined)}
          >
            <FolderOpen aria-hidden="true" size={16} strokeWidth={1.75} />
            Open folder
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" size={16} strokeWidth={1.75} />
            Delete
          </Button>
        </div>
      </header>

      {confirmDelete && (
        <div
          role="alertdialog"
          aria-label="Delete this recording?"
          className="flex flex-wrap items-center gap-3 border-b border-ui-border bg-ui-surface px-4 py-3 text-[14px]"
        >
          <p className="flex-1">
            Delete this recording? Its files go to the Recycle Bin, and it is removed from Meetings
            on every device.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="border-b border-ui-border px-4 py-2 text-[13px] text-ui-muted">
          {message}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {parts.length > 1 && (
            <nav aria-label="Parts" className="flex flex-wrap gap-2">
              {parts.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  aria-current={part.id === record.id ? 'true' : undefined}
                  className={`h-8 rounded-control border px-3 text-[13px] ${part.id === record.id ? 'border-ui-accent-fill text-ui-heading' : 'border-ui-border text-ui-text hover:bg-ui-hover'}`}
                  onClick={() => setId(part.id)}
                >
                  Part {part.part}
                </button>
              ))}
            </nav>
          )}
          {video ? (
            <video
              key={record.id}
              ref={(element) => {
                media.current = element;
              }}
              src={recordingFileUrl(record.id)}
              controls
              className="min-h-0 w-full flex-1 rounded-card bg-black"
              onTimeUpdate={(event) =>
                setCurrent(currentLineIndex(partLines, event.currentTarget.currentTime))
              }
            />
          ) : (
            <audio
              key={record.id}
              ref={(element) => {
                media.current = element;
              }}
              src={recordingFileUrl(record.id)}
              controls
              className="w-full"
              onTimeUpdate={(event) =>
                setCurrent(currentLineIndex(partLines, event.currentTarget.currentTime))
              }
            />
          )}
        </section>
        <aside
          aria-label="Transcript"
          className="flex min-h-0 w-full flex-col border-t border-ui-border md:w-96 md:border-l md:border-t-0"
        >
          <h2 className="px-4 pt-3 text-[13px] font-semibold uppercase tracking-wide text-ui-muted">
            Transcript
          </h2>
          {partLines.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ui-muted">
              No saved transcript for this part (the session may not save its transcript).
            </p>
          ) : (
            <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {partLines.map(({ line, at }, index) => (
                <li key={line.id}>
                  <button
                    type="button"
                    className={`flex w-full gap-2 rounded-control px-2 py-1.5 text-left text-[14px] hover:bg-ui-hover ${index === current ? 'bg-ui-hover' : ''}`}
                    onClick={() => {
                      if (!media.current) return;
                      media.current.currentTime = at;
                      void media.current.play().catch(() => undefined);
                    }}
                  >
                    <span className="w-12 shrink-0 tabular-nums text-ui-muted">{clock(at)}</span>
                    <span className="min-w-0">
                      <span className="font-semibold text-ui-heading">
                        {line.speaker === 'you' ? names.you : names.them}:
                      </span>{' '}
                      {line.text}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
