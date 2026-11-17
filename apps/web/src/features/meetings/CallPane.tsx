/**
 * File: apps/web/src/features/meetings/CallPane.tsx
 * Purpose: The right pane of the Meetings library (ADR-0096): the shown call's header (session, date and
 *          time, length, "with <their name>", and its recording status: Recorded / Uploading… / Saved on
 *          <computer> only / Not recorded) and four tabs: Watch, Conversation, AI notes and Files. The tabs
 *          are ARIA tabs (← / → / Home / End move between them). Watch opens first when the call was
 *          recorded, Conversation otherwise. On a narrow screen "All meetings" goes back to the list.
 * Used by: MeetingsPage.tsx
 * Depends on: lucide-react, src/core/meetings/library.ts, src/core/drive/names.ts (sessionTitle),
 *             src/core/transcript (turns, display, theirName), src/features/review/CallsList.tsx
 *             (callLengthText), ./WatchTab.tsx, ./ConversationTab.tsx, ./NotesTab.tsx, ./FilesTab.tsx,
 *             ./useCallDrive.ts, src/ui/Badge.tsx
 * Architecture: docs/decisions/ADR-0096-meetings-library.md
 *
 * Call details are shown on screen only; nothing is logged.
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { sessionTitle } from '@/core/drive/names';
import { callTheirName, recordingStatus, type LibraryFolder } from '@/core/meetings/library';
import type { CallView } from '@/core/review/calls';
import { displayTerms } from '@/core/transcript/display';
import { withTheirName } from '@/core/transcript/theirName';
import { speakerNames } from '@/core/transcript/turns';
import { callLengthText } from '@/features/review/CallsList';
import type { RecordingHost } from '@/platform/types';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { ConversationTab } from './ConversationTab';
import { FilesTab } from './FilesTab';
import { NotesTab } from './NotesTab';
import { useCallDrive } from './useCallDrive';
import { WatchTab } from './WatchTab';

/** The call view's tabs. */
type TabName = 'watch' | 'conversation' | 'notes' | 'files';

/** The tabs, in order. */
const TABS: readonly { value: TabName; label: string }[] = [
  { value: 'watch', label: 'Watch' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'notes', label: 'AI notes' },
  { value: 'files', label: 'Files' },
];

/** The status pill's colour for each recording status. */
const STATUS_TONES: Readonly<Record<ReturnType<typeof recordingStatus>['kind'], BadgeTone>> = {
  recorded: 'success',
  uploading: 'neutral',
  'device-only': 'warning',
  none: 'neutral',
  recording: 'danger',
};

/** The header's date and time ("Tue, 17 Nov 2026, 14:05"), in the user's locale. */
const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Props for CallPane. */
export interface CallPaneProps {
  /** The call's session folder. */
  folder: LibraryFolder;
  /** The call. */
  call: CallView;
  /** The signed-in account's display name. */
  accountName: string | null;
  /** The desktop app's recording host; null in a browser. */
  host: RecordingHost | null;
  /** The desktop app: ids of the recordings whose files are on this computer; null in a browser. */
  localIds: ReadonlySet<string> | null;
  /** Reads the library again (new notes). */
  onChanged: () => void;
  /** Goes back to the list (narrow screens). */
  onBack: () => void;
}

/**
 * The call pane. Rendered with the call's id as its key, so a new call starts on its own first tab.
 *
 * @param props See CallPaneProps.
 * @returns The pane.
 * Rendered by: MeetingsPage.tsx
 */
export function CallPane({
  folder,
  call,
  accountName,
  host,
  localIds,
  onChanged,
  onBack,
}: CallPaneProps) {
  const { session } = folder;
  const [tab, setTab] = useState<TabName>(call.recordings.length > 0 ? 'watch' : 'conversation');
  const tabRefs = useRef(new Map<TabName, HTMLButtonElement>());
  const baseId = useId();
  const status = recordingStatus(call);
  const them = callTheirName(session, call);
  const live = call.record !== null && call.record.phase !== 'ended';
  // ADR-0093: the call's own name for the other person wins over the session's.
  const names = speakerNames(withTheirName(session, call.record), accountName);
  const terms = useMemo(() => displayTerms(session), [session]);
  // Asked again when the call's Drive upload moves on (a finished upload has new links).
  const drive = useCallDrive(session.id, call.startedAt, call.record?.drive.state ?? 'none');

  /**
   * ← / → / Home / End between the tabs (ARIA tabs pattern, automatic activation).
   * @param event The key press on a tab.
   */
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = TABS.findIndex((one) => one.value === tab);
    const next =
      event.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    const value = TABS[next]!.value;
    setTab(value);
    tabRefs.current.get(value)?.focus();
  };

  return (
    <article aria-label="Call" className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 rounded-control text-[13px] font-medium text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] lg:hidden"
      >
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.75} />
        All meetings
      </button>

      <header className="flex flex-col gap-1.5">
        <p className="truncate text-[12px] text-ui-muted">{folder.name}</p>
        <h2 className="break-words text-card-title text-ui-heading">{sessionTitle(session)}</h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ui-text">
          <span>{WHEN.format(call.startedAt)}</span>
          <span aria-hidden="true" className="text-ui-muted">
            ·
          </span>
          <span>{live ? 'In progress' : callLengthText(call.durationMs)}</span>
          {them && (
            <>
              <span aria-hidden="true" className="text-ui-muted">
                ·
              </span>
              <span>with {them}</span>
            </>
          )}
          <span aria-hidden="true" className="text-ui-muted">
            ·
          </span>
          <Badge tone={STATUS_TONES[status.kind]}>{status.label}</Badge>
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Call views"
        className="flex gap-1 overflow-x-auto border-b border-ui-border"
      >
        {TABS.map((one) => {
          const selected = one.value === tab;
          return (
            <button
              key={one.value}
              ref={(element) => {
                if (element) tabRefs.current.set(one.value, element);
                else tabRefs.current.delete(one.value);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${one.value}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${one.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(one.value)}
              onKeyDown={onTabKey}
              className={[
                '-mb-px shrink-0 border-b-2 px-3 py-2 text-[14px] font-medium focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11',
                selected
                  ? 'border-ui-accent-fill text-ui-heading'
                  : 'border-transparent text-ui-muted hover:text-ui-text',
              ].join(' ')}
            >
              {one.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${tab}`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {tab === 'watch' && (
          <WatchTab call={call} names={names} localIds={localIds} status={status} drive={drive} />
        )}
        {tab === 'conversation' && <ConversationTab call={call} names={names} terms={terms} />}
        {tab === 'notes' && <NotesTab session={session} call={call} onChanged={onChanged} />}
        {tab === 'files' && (
          <FilesTab
            session={session}
            call={call}
            accountName={accountName}
            host={host}
            localIds={localIds}
            drive={drive}
          />
        )}
      </div>
    </article>
  );
}
