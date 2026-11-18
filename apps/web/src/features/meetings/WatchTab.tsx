/**
 * File: apps/web/src/features/meetings/WatchTab.tsx
 * Purpose: The Meetings library's Watch tab (ADR-0096): the call's recording with its own transcript
 *          beside it. In the desktop app on the computer that holds the file, it plays in the page
 *          (kite-recording://, the player window's own address): the line being spoken is highlighted and
 *          kept in view, a click on a line jumps there, and the transcript can be searched. Anywhere else it
 *          offers "Watch in Drive ↗" when the recording is in Google Drive, or says where it stands
 *          ("Uploading…", "Saved on <computer> only", "Not recorded"); the transcript shows with each line's
 *          time in the call.
 * Used by: CallPane.tsx
 * Depends on: @kite/shared (recordingFileUrl, desktopRecordingLink), lucide-react,
 *             src/core/recording/meetings.ts (linesInPart, currentLineIndex, formatBytes),
 *             src/core/meetings/library.ts, src/core/review/load.ts (formatCallTime), ./useCallDrive.ts,
 *             src/ui (Input, Button)
 * Architecture: docs/decisions/ADR-0096-meetings-library.md; ADR-0068 (recordings stay on their computer)
 *
 * Transcript words are shown on screen only; nothing is logged.
 */
'use client';

import { desktopRecordingLink, recordingFileUrl } from '@kite/shared';
import { ExternalLink, MonitorDown, Search, VideoOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { lineMatches, type RecordingStatus } from '@/core/meetings/library';
import { currentLineIndex, linesInPart, type PartLine } from '@/core/recording/meetings';
import type { CallView } from '@/core/review/calls';
import { formatCallTime } from '@/core/review/load';
import type { StoredRecording } from '@/core/storage/types';
import type { SpeakerNames } from '@/core/transcript/turns';
import { Button, buttonClasses } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { DriveAccessNote } from './DriveAccessNote';
import type { CallDriveState } from './useCallDrive';

/** How long the page waits before saying what to do when the desktop app did not open (ADR-0052). */
const NOTHING_OPENED_MS = 6_000;

/** Props for WatchTab. */
export interface WatchTabProps {
  /** The call. */
  call: CallView;
  /** The names on each side's lines. */
  names: SpeakerNames;
  /**
   * The desktop app: the ids of the recordings whose files are on this computer; null in a browser (it
   * cannot play them).
   */
  localIds: ReadonlySet<string> | null;
  /** The call's recording status. */
  status: RecordingStatus;
  /** The call's Drive side. */
  drive: CallDriveState;
}

/**
 * Follows a paramountai:// link (a link click is what browsers expect for an app link).
 * @param link The link.
 */
function followLink(link: string): void {
  const anchor = document.createElement('a');
  anchor.href = link;
  anchor.click();
}

/**
 * What shows in the player's place when the recording cannot play here.
 *
 * @param props.call   The call.
 * @param props.status Its recording status.
 * @param props.drive  Its Drive side.
 * @param props.browser True in a browser ("Open in desktop app" is offered for a computer's recording).
 * @returns The panel.
 * Rendered by: WatchTab
 */
function NotHere({
  call,
  status,
  drive,
  browser,
}: {
  /** The call. */
  call: CallView;
  /** Its recording status. */
  status: RecordingStatus;
  /** Its Drive side. */
  drive: CallDriveState;
  /** True in a browser. */
  browser: boolean;
}) {
  const [hint, setHint] = useState(false);
  const links =
    drive.kind === 'ready' ? drive.drive.files.filter((file) => file.kind === 'recording') : [];
  const first = call.recordings[0];
  const box =
    'flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-card border border-ui-border bg-ui-subtle p-6 text-center';

  if (status.kind === 'none') {
    return (
      <div className={box}>
        <VideoOff aria-hidden="true" size={28} strokeWidth={1.5} className="text-ui-text" />
        <p className="text-[15px] font-medium text-ui-heading">Not recorded</p>
        <p className="max-w-sm text-[13px] text-ui-text">
          This call was not recorded. Its transcript, conversation and notes are still here.
        </p>
      </div>
    );
  }
  if (links.length > 0) {
    return (
      <div className={box}>
        <p className="text-[15px] font-medium text-ui-heading">The recording is in Google Drive</p>
        <div className="flex flex-wrap justify-center gap-2">
          {links.map((file) => (
            <a
              key={file.url}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('accent', 'md')}
            >
              {links.length > 1 ? `Watch part ${file.part} in Drive` : 'Watch in Drive'}
              <ExternalLink aria-hidden="true" size={16} strokeWidth={1.75} />
            </a>
          ))}
        </div>
        {drive.kind === 'ready' && <DriveAccessNote access={drive.drive.access} />}
      </div>
    );
  }
  return (
    <div className={box}>
      <p className="text-[15px] font-medium text-ui-heading">{status.label}</p>
      <p className="max-w-sm text-[13px] text-ui-text">
        {drive.kind === 'loading'
          ? 'Looking for the recording in Google Drive…'
          : status.kind === 'recording'
            ? 'The call is still being recorded.'
            : status.kind === 'uploading'
              ? 'The recording is being uploaded to Google Drive. Watch it here once it is saved.'
              : status.kind === 'stalled'
                ? 'The upload carries on as soon as the desktop app is open on that computer.'
                : 'Open Meetings in the desktop app on that computer to watch it there.'}
      </p>
      {browser && first && (status.kind === 'device-only' || status.kind === 'stalled') && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setHint(false);
            followLink(desktopRecordingLink(first.id));
            window.setTimeout(() => setHint(true), NOTHING_OPENED_MS);
          }}
        >
          <MonitorDown aria-hidden="true" size={16} strokeWidth={1.75} />
          Open in desktop app
        </Button>
      )}
      {hint && (
        <p role="status" className="max-w-sm text-[12px] text-ui-text">
          Nothing opened? Update the desktop app (it updates itself when you restart it), and open
          the recording on the computer that saved it.
        </p>
      )}
    </div>
  );
}

/**
 * The Watch tab.
 *
 * @param props See WatchTabProps.
 * @returns The tab's content.
 * Rendered by: CallPane.tsx
 */
export function WatchTab({ call, names, localIds, status, drive }: WatchTabProps) {
  // The parts this computer can play (the desktop app), first part first.
  const playable = useMemo(
    () =>
      localIds
        ? [...call.recordings]
            .filter((part) => localIds.has(part.id) && part.status !== 'recording')
            .sort((a, b) => a.part - b.part)
        : [],
    [call.recordings, localIds],
  );
  const [partId, setPartId] = useState<string | null>(null);
  const part: StoredRecording | null =
    playable.find((one) => one.id === partId) ?? playable[0] ?? null;
  // The clock for a part with no length yet (read once, as the player window does).
  const [now] = useState(() => Date.now());
  const timeline: PartLine[] = useMemo(
    () =>
      part
        ? linesInPart(call.lines, part, now)
        : call.lines.map((line) => ({
            line,
            at: Math.max(0, (line.tStart - call.startedAt) / 1000),
          })),
    [part, call.lines, call.startedAt, now],
  );
  const [current, setCurrent] = useState(-1);
  const [query, setQuery] = useState('');
  const media = useRef<HTMLMediaElement | null>(null);
  const lineRefs = useRef(new Map<number, HTMLElement>());
  const searching = query.trim() !== '';
  const shown = timeline
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => lineMatches(entry.line, query));

  // The line being spoken stays in view while the video plays (not while the person searches).
  useEffect(() => {
    if (searching || current < 0) return;
    lineRefs.current.get(current)?.scrollIntoView({ block: 'nearest' });
  }, [current, searching]);

  /**
   * Jumps the video to a line and plays.
   * @param at Seconds from the part's start.
   */
  const jump = (at: number) => {
    if (!media.current) return;
    media.current.currentTime = at;
    void media.current.play().catch(() => undefined);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-label="Recording" className="flex min-w-0 flex-col gap-3">
        {playable.length > 1 && (
          <div role="group" aria-label="Recording parts" className="flex flex-wrap gap-2">
            {playable.map((one) => (
              <button
                key={one.id}
                type="button"
                aria-pressed={one.id === part?.id}
                onClick={() => {
                  setPartId(one.id);
                  setCurrent(-1);
                }}
                className={`h-8 rounded-control border px-3 text-[13px] focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] ${one.id === part?.id ? 'border-ui-accent-fill text-ui-heading' : 'border-ui-border text-ui-text hover:bg-ui-hover'}`}
              >
                Part {one.part}
              </button>
            ))}
          </div>
        )}
        {part ? (
          part.kind === 'screen' ? (
            <video
              key={part.id}
              ref={(element) => {
                media.current = element;
              }}
              src={recordingFileUrl(part.id)}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-card bg-black"
              onTimeUpdate={(event) =>
                setCurrent(currentLineIndex(timeline, event.currentTarget.currentTime))
              }
            />
          ) : (
            <div className="flex flex-col gap-2 rounded-card border border-ui-border bg-ui-surface p-4">
              <p className="text-[13px] text-ui-text">Sound only</p>
              <audio
                key={part.id}
                ref={(element) => {
                  media.current = element;
                }}
                src={recordingFileUrl(part.id)}
                controls
                preload="metadata"
                className="w-full"
                onTimeUpdate={(event) =>
                  setCurrent(currentLineIndex(timeline, event.currentTarget.currentTime))
                }
              />
            </div>
          )
        ) : (
          <NotHere call={call} status={status} drive={drive} browser={localIds === null} />
        )}
      </section>

      <aside
        aria-label="Transcript"
        className="flex max-h-[70vh] min-h-0 flex-col rounded-card border border-ui-border bg-ui-surface xl:max-h-[calc(100dvh-15rem)]"
      >
        <div className="flex flex-col gap-2 border-b border-ui-border p-3">
          <h3 className="text-[13px] font-semibold text-ui-heading">Transcript</h3>
          {timeline.length > 0 && (
            <Input
              label="Search the transcript"
              hideLabel
              type="search"
              placeholder="Search the transcript"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              end={
                <Search aria-hidden="true" size={16} strokeWidth={1.75} className="text-ui-muted" />
              }
            />
          )}
        </div>
        {timeline.length === 0 ? (
          <p className="p-4 text-[13px] text-ui-muted">
            {call.lines.length === 0
              ? 'No transcript was saved for this call ("Save transcript" was off, or nothing was heard).'
              : 'No transcript lines in this part.'}
          </p>
        ) : shown.length === 0 ? (
          <p role="status" className="p-4 text-[13px] text-ui-muted">
            No lines match.
          </p>
        ) : (
          <ol className="min-h-0 flex-1 overflow-y-auto p-2">
            {shown.map(({ entry, index }) => {
              const active = index === current;
              const content = (
                <>
                  <span className="w-12 shrink-0 tabular-nums text-ui-muted">
                    {formatCallTime(entry.at)}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`font-semibold ${entry.line.speaker === 'you' ? 'text-ui-you' : 'text-ui-them'}`}
                    >
                      {entry.line.speaker === 'you' ? names.you : names.them}:
                    </span>{' '}
                    {entry.line.text}
                  </span>
                </>
              );
              const classes = `flex w-full gap-2 rounded-control px-2 py-1.5 text-left text-[13px] text-ui-text ${active ? 'bg-ui-accent-tint' : ''}`;
              return (
                <li
                  key={entry.line.id}
                  ref={(element) => {
                    if (element) lineRefs.current.set(index, element);
                    else lineRefs.current.delete(index);
                  }}
                  aria-current={active ? 'true' : undefined}
                >
                  {part ? (
                    <button
                      type="button"
                      className={`${classes} hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]`}
                      onClick={() => jump(entry.at)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={classes}>{content}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </aside>
    </div>
  );
}
