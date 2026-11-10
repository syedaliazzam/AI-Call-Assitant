/**
 * File: apps/web/src/features/meetings/MeetingsPage.tsx
 * Purpose: The Meetings page (desktop 1.5.0, ADR-0068): every recorded meeting of the account, newest
 *          first, with its date, session, length, size, parts and "Saved on <computer>". The recordings
 *          themselves stay on the computer that made them: in a browser, "Open in desktop app" opens the
 *          desktop app's player on that computer (paramountai://recording/<id>), and after a few seconds
 *          says what to do when nothing opened; in the desktop app, Play is offered for this computer's
 *          recordings, and this computer's name can be changed.
 * Used by: app/(app)/meetings/page.tsx
 * Depends on: @kite/shared (desktopRecordingLink), src/core/storage (recordings, sessions),
 *             src/core/recording (meetings.ts, reconcile.ts), src/platform, src/ui (PageShell, Button)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; ADR-0052 (the "update" fallback)
 * Session details are shown on screen only; nothing is logged.
 */
'use client';

import { desktopRecordingLink, type DeviceIdentity } from '@kite/shared';
import { MonitorDown, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  formatBytes,
  formatDuration,
  groupMeetings,
  type MeetingGroup,
} from '@/core/recording/meetings';
import { reconcileRecordings } from '@/core/recording/reconcile';
import { watchRecordings } from '@/core/storage/recordings';
import { watchSessions } from '@/core/storage/sessions';
import type { Session, StoredRecording } from '@/core/storage/types';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { PageShell } from '@/ui/PageShell';

/** How long the page waits before saying what to do when the desktop app did not open (ADR-0052). */
const NOTHING_OPENED_MS = 6_000;

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
 * A session's name for a meeting row: "Company · Role", or what it has.
 * @param session The session, or undefined when it is not on this device yet.
 * @returns The name.
 */
function sessionName(session: Session | undefined): string {
  if (!session) return 'Session';
  return [session.company, session.role].filter((part) => part.trim()).join(' · ') || 'Session';
}

/** Words of a meeting's status, when it is not simply complete. */
const STATUS_WORDS: Readonly<Partial<Record<MeetingGroup['status'], string>>> = {
  recording: 'Recording…',
  recovered: 'Recovered after the app stopped',
};

/**
 * One meeting row.
 * @param props.meeting  The meeting.
 * @param props.session  Its session.
 * @param props.here     True when this desktop app holds its files; false on another computer; null in
 *                       a browser (it cannot tell).
 * @param props.onPlay   Plays it here (the desktop app).
 * @param props.onOpen   Opens it in the desktop app (a browser).
 * @returns The row.
 * Rendered by: MeetingsPage
 */
function MeetingRow({
  meeting,
  session,
  here,
  onPlay,
  onOpen,
}: {
  /** The meeting. */
  meeting: MeetingGroup;
  /** Its session. */
  session: Session | undefined;
  /** True: on this computer; false: on another; null: unknown (a browser). */
  here: boolean | null;
  /** Plays it here. */
  onPlay: (part: StoredRecording) => void;
  /** Opens it in the desktop app. */
  onOpen: (part: StoredRecording) => void;
}) {
  const first = meeting.parts[0]!;
  const when = new Date(meeting.startedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const status = STATUS_WORDS[meeting.status];
  return (
    <li className="flex flex-col gap-3 rounded-card border border-ui-border bg-ui-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-[15px] font-semibold text-ui-heading">{sessionName(session)}</p>
        <p className="text-[13px] text-ui-muted">
          {when} · {formatDuration(meeting.durationMs)} · {formatBytes(meeting.bytes)} ·{' '}
          {meeting.kind === 'screen' ? 'Screen + audio' : 'Audio only'}
          {meeting.parts.length > 1 ? ` · ${meeting.parts.length} parts` : ''}
        </p>
        <p className="text-[13px] text-ui-text">
          Saved on {meeting.deviceName}
          {status ? <span className="text-ui-muted"> · {status}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {here === true && (
          <Button variant="secondary" size="sm" onClick={() => onPlay(first)}>
            <Play aria-hidden="true" size={16} strokeWidth={1.75} />
            Play
          </Button>
        )}
        {here === null && (
          <Button variant="secondary" size="sm" onClick={() => onOpen(first)}>
            <MonitorDown aria-hidden="true" size={16} strokeWidth={1.75} />
            Open in desktop app
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * This computer’s name, renamable (the desktop app).
 * @param props.device   The identity.
 * @param props.onRename Saves a new name.
 * @returns The line.
 * Rendered by: MeetingsPage
 */
function DeviceName({
  device,
  onRename,
}: {
  /** The identity. */
  device: DeviceIdentity;
  /** Saves a new name. */
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  if (!editing) {
    return (
      <p className="text-[13px] text-ui-muted">
        This computer: <span className="text-ui-text">{device.name}</span>{' '}
        <button
          type="button"
          className="underline underline-offset-4 hover:text-ui-text"
          onClick={() => {
            setName(device.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
      </p>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-[13px]"
      onSubmit={(event) => {
        event.preventDefault();
        onRename(name);
        setEditing(false);
      }}
    >
      <label htmlFor="device-name" className="text-ui-muted">
        This computer’s name
      </label>
      <input
        id="device-name"
        className="h-8 rounded-control border border-ui-border bg-ui-bg px-2 text-ui-text"
        maxLength={60}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button size="sm" variant="secondary" type="submit">
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * The page.
 * @returns The page.
 * Rendered by: app/(app)/meetings/page.tsx
 */
export function MeetingsPage() {
  const [records, setRecords] = useState<StoredRecording[] | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [failed, setFailed] = useState(false);
  const [device, setDevice] = useState<DeviceIdentity | null>(null);
  const [hint, setHint] = useState(false);
  const host = getPlatform().recording;

  useEffect(
    () =>
      watchRecordings(
        (rows) => setRecords(rows),
        () => setFailed(true),
      ),
    [],
  );
  useEffect(
    () =>
      watchSessions(
        (rows) => setSessions(rows),
        () => undefined,
      ),
    [],
  );
  // The desktop app: this computer's identity, and its recordings brought up to date in the account.
  useEffect(() => {
    if (!host) return;
    let live = true;
    host
      .device()
      .then((identity) => {
        if (live) setDevice(identity);
      })
      .catch(() => undefined);
    void reconcileRecordings(host).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [host]);

  const meetings = useMemo(() => groupMeetings(records ?? []), [records]);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  /**
   * Opens a recording in the desktop app (a browser), and says what to do when nothing opened.
   * @param part The meeting's first part.
   */
  const open = (part: StoredRecording) => {
    setHint(false);
    followLink(desktopRecordingLink(part.id));
    window.setTimeout(() => setHint(true), NOTHING_OPENED_MS);
  };

  return (
    <PageShell
      title="Meetings"
      description="Your recorded meetings. The video and sound stay on the computer that recorded them; only these details are in your account."
      width="lg"
    >
      <div className="flex flex-col gap-4">
        {host && device && (
          <DeviceName
            device={device}
            onRename={(name) =>
              void host
                .renameDevice(name)
                .then(setDevice)
                .catch(() => undefined)
            }
          />
        )}
        {hint && (
          <p role="status" className="text-helper text-ui-muted">
            Nothing opened? Update the desktop app to 1.5.0 or later (it updates itself when you
            restart it), and open the recording on the computer that saved it.
          </p>
        )}
        {failed && (
          <p role="alert" className="text-helper text-ui-danger">
            The recordings could not be read. Reload the page.
          </p>
        )}
        {records && meetings.length === 0 && (
          <section className="rounded-card border border-ui-border bg-ui-surface px-6 py-10 text-center shadow-card">
            <p className="text-[15px] text-ui-muted">
              No recordings yet. In the desktop app, set Record on the Connect card, or press Rec on
              the call bar during a call.
            </p>
          </section>
        )}
        {meetings.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label="Recorded meetings">
            {meetings.map((meeting) => (
              <MeetingRow
                key={meeting.meetingId}
                meeting={meeting}
                session={byId.get(meeting.sessionId)}
                here={host ? (device ? meeting.deviceId === device.id : false) : null}
                onPlay={(part) => void host?.play(part.id).catch(() => undefined)}
                onOpen={open}
              />
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
