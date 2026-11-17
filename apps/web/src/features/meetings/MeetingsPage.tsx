/**
 * File: apps/web/src/features/meetings/MeetingsPage.tsx
 * Purpose: The Meetings page as a meeting library (ADR-0096; it replaced the 1.5.0 list of recordings,
 *          ADR-0068): two panes, the library on the left (search, date filter, session folders named as in
 *          Google Drive, one row per call) and the chosen call on the right (CallPane: Watch, Conversation,
 *          AI notes, Files). On a narrow screen the list and the call take turns ("All meetings" goes
 *          back). The call opened last is remembered (per account, on this browser). Everything comes from
 *          this device's copy of the account's synced call data: it pulls the account's newest data first,
 *          reads again after every sync and while a call is still being finished, so the transcript,
 *          conversation and notes show in any browser before anything reaches Google Drive. In the desktop
 *          app it also knows which recordings are on this computer (they play in the page) and keeps this
 *          computer's name renamable.
 * Used by: app/(app)/meetings/page.tsx
 * Depends on: @kite/shared (DeviceIdentity), src/core/meetings/{load,library}.ts,
 *             src/core/storage/{meetingsPrefs,recordings,sessions}.ts, src/core/recording/reconcile.ts,
 *             src/core/sync (client, events), src/features/shell/AccountName.tsx, src/platform,
 *             ./LibraryPane.tsx, ./CallPane.tsx, src/ui (Button, LinkButton)
 * Architecture: docs/decisions/ADR-0096-meetings-library.md; ADR-0068 (recordings), ADR-0077 (calls)
 *
 * Privacy: the local database belongs to the signed-in account only (ADR-0082) and the server syncs and
 * shares only that account's own records and Drive folders (ADR-0096), so each person sees only their own
 * calls, admins included. Session details are shown on screen only; nothing is logged.
 */
'use client';

import type { DeviceIdentity } from '@kite/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { findCall, type LibraryFolder } from '@/core/meetings/library';
import { loadLibrary } from '@/core/meetings/load';
import { reconcileRecordings } from '@/core/recording/reconcile';
import { getLastMeetingCall, setLastMeetingCall } from '@/core/storage/meetingsPrefs';
import { watchRecordings } from '@/core/storage/recordings';
import { watchSessions } from '@/core/storage/sessions';
import { pullAccountSync } from '@/core/sync/client';
import { onSyncApplied } from '@/core/sync/events';
import { useAccountName } from '@/features/shell/AccountName';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { LinkButton } from '@/ui/LinkButton';
import { CallPane } from './CallPane';
import { LibraryPane } from './LibraryPane';

/** While a call is still being finished (running, or its notes not written), how often to look again, ms. */
const FINISHING_REFRESH_MS = 10_000;

/** No recording files on this computer (the desktop app, before its list arrives). */
const NONE_HERE: ReadonlySet<string> = new Set();

/** Several changes in a row (a sync writes many rows) are read once, after this pause, ms. */
const RELOAD_DEBOUNCE_MS = 400;

/**
 * This computer's name, renamable (the desktop app).
 * @param props.device   The identity.
 * @param props.onRename Saves a new name.
 * @returns The line.
 * Rendered by: MeetingsPage (the library's footer)
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
      <p className="text-[12px] text-ui-muted">
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
      className="flex flex-wrap items-center gap-2 text-[12px]"
      onSubmit={(event) => {
        event.preventDefault();
        onRename(name);
        setEditing(false);
      }}
    >
      <label htmlFor="device-name" className="sr-only">
        This computer’s name
      </label>
      <input
        id="device-name"
        className="h-8 min-w-0 flex-1 rounded-control border border-ui-border bg-ui-input px-2 text-ui-text"
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
 * Whether a call is still being finished here or on another device (running, or its notes not written).
 * @param folders The library.
 * @returns True while one is.
 */
function anyFinishing(folders: readonly LibraryFolder[]): boolean {
  return folders.some((folder) =>
    folder.calls.some(
      (call) =>
        call.record !== null && (call.record.phase !== 'ended' || call.notesState === 'writing'),
    ),
  );
}

/**
 * The page.
 * @returns The page.
 * Rendered by: app/(app)/meetings/page.tsx
 */
export function MeetingsPage() {
  const [folders, setFolders] = useState<LibraryFolder[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // The call chosen on this page, else the one opened last (read on the client only; null on the server).
  const [chosenId, setChosenId] = useState<string | null>(() => getLastMeetingCall());
  // Narrow screens: true while the call is shown instead of the list.
  const [showCall, setShowCall] = useState(false);
  const [device, setDevice] = useState<DeviceIdentity | null>(null);
  const [localIds, setLocalIds] = useState<ReadonlySet<string> | null>(null);
  const accountName = useAccountName();
  const host = getPlatform().recording;

  /** Reads the library again from this device's copy of the call data. */
  const reload = useCallback(async () => {
    try {
      setFolders(await loadLibrary());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // The account's newest data first (a call ended on another device), then this device's copy; and again
  // after every sync and every local change (debounced: a sync writes many rows).
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (live) void reload();
      }, RELOAD_DEBOUNCE_MS);
    };
    void (async () => {
      await pullAccountSync().catch(() => undefined);
      if (live) await reload();
    })();
    const stops = [
      onSyncApplied(soon),
      watchSessions(soon, () => undefined),
      watchRecordings(soon, () => undefined),
    ];
    return () => {
      live = false;
      window.clearTimeout(timer);
      for (const stop of stops) stop();
    };
  }, [reload]);

  // While a call is being finished (here or elsewhere), look again every few seconds for its notes.
  const finishing = folders ? anyFinishing(folders) : false;
  useEffect(() => {
    if (!finishing) return;
    const timer = window.setInterval(() => {
      void (async () => {
        await pullAccountSync().catch(() => undefined);
        await reload();
      })();
    }, FINISHING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [finishing, reload]);

  // The desktop app: this computer's identity, its recordings brought up to date in the account, and which
  // recordings' files are here (they play in the page). Read again when the recordings change.
  const recordingsKey = useMemo(
    () =>
      (folders ?? [])
        .flatMap((folder) => folder.calls.flatMap((call) => call.recordings.map((r) => r.id)))
        .join(','),
    [folders],
  );
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
  useEffect(() => {
    if (!host) return;
    let live = true;
    host
      .list()
      .then((entries) => {
        if (!live) return;
        setLocalIds(
          new Set(
            entries
              .filter((entry) => entry.status === 'complete' || entry.status === 'recovered')
              .map((entry) => entry.id),
          ),
        );
      })
      .catch(() => {
        if (live) setLocalIds(new Set());
      });
    return () => {
      live = false;
    };
  }, [host, recordingsKey]);

  // The shown call: the chosen one while it exists, else the newest.
  const shown = useMemo(() => {
    if (!folders || folders.length === 0) return null;
    const found = chosenId ? findCall(folders, chosenId) : null;
    return found ?? { folder: folders[0]!, call: folders[0]!.calls[0]! };
  }, [folders, chosenId]);

  /**
   * Opens a call: remembers it, and on a narrow screen shows it instead of the list.
   * @param callId The call.
   */
  const open = (callId: string) => {
    setChosenId(callId);
    setLastMeetingCall(callId);
    setShowCall(true);
  };

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      <h1 className="sr-only">Meetings</h1>
      <aside
        aria-label="Meeting library"
        className={`${showCall ? 'hidden' : 'flex'} min-h-0 flex-col bg-ui-surface lg:flex lg:w-[340px] lg:shrink-0 lg:border-r lg:border-ui-border`}
      >
        <LibraryPane
          folders={folders}
          selectedId={shown?.call.id ?? null}
          onSelect={open}
          footer={
            host && device ? (
              <DeviceName
                device={device}
                onRename={(name) =>
                  void host
                    .renameDevice(name)
                    .then(setDevice)
                    .catch(() => undefined)
                }
              />
            ) : undefined
          }
        />
      </aside>

      <section
        aria-label="Selected call"
        className={`${showCall ? 'block' : 'hidden'} min-w-0 flex-1 px-4 py-5 sm:px-6 lg:block lg:overflow-y-auto`}
      >
        <div className="mx-auto max-w-6xl">
          {failed && (
            <p role="alert" className="mb-4 text-[13px] text-ui-danger">
              Your meetings could not be read. Reload the page.
            </p>
          )}
          {folders === undefined && !failed && (
            <div
              aria-hidden="true"
              className="flex animate-pulse flex-col gap-3 motion-reduce:animate-none"
            >
              <div className="h-4 w-48 rounded-control bg-ui-subtle" />
              <div className="h-7 w-80 max-w-full rounded-control bg-ui-subtle" />
              <div className="mt-4 aspect-video w-full rounded-card bg-ui-subtle" />
            </div>
          )}
          {folders !== undefined && folders.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-card border border-ui-border bg-ui-surface px-6 py-12 text-center shadow-card">
              <h2 className="text-[18px] font-semibold text-ui-heading">No meetings yet</h2>
              <p className="max-w-md text-[14px] text-ui-text">
                Every call you take with Paramount AI appears here, with its recording, the
                conversation, AI notes and files.
              </p>
              <LinkButton href="/sessions/new" variant="accent">
                Create session
              </LinkButton>
            </div>
          )}
          {shown && (
            <CallPane
              key={shown.call.id}
              folder={shown.folder}
              call={shown.call}
              accountName={accountName}
              host={host}
              // The desktop app before its list arrives: no file here yet (never "a browser").
              localIds={host ? (localIds ?? NONE_HERE) : null}
              onChanged={() => void reload()}
              onBack={() => setShowCall(false)}
            />
          )}
        </div>
      </section>
    </div>
  );
}
