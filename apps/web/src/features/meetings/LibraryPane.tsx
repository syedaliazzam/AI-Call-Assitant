/**
 * File: apps/web/src/features/meetings/LibraryPane.tsx
 * Purpose: The left pane of the Meetings library (ADR-0096): a search box (company, session, the other
 *          person's name) and a date filter, then the session folders named as in Google Drive
 *          ("<YYYY-MM-DD> <Company> – <Session>"), newest first, each opening to one row per call: date and
 *          time, length, and small icons for recorded, AI notes and transcript. Folders open with a click
 *          or Enter; ↑ / ↓ (and Home / End) move between folders and calls. ADR-0098: a session live on
 *          another device of the account shows a red dot and "Live on another device" on its folder.
 * Used by: MeetingsPage.tsx
 * Depends on: lucide-react (icons), src/core/meetings/library.ts, src/features/review/CallsList.tsx
 *             (callLengthText), src/ui (Input, Select)
 * Architecture: docs/decisions/ADR-0096-meetings-library.md; ADR-0098
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 *
 * Session details are shown on screen only; nothing is logged.
 */
'use client';

import { ChevronRight, FileText, Folder, Search, Sparkles, Video } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  LIBRARY_RANGES,
  callMarks,
  callTheirName,
  filterLibrary,
  type LibraryFolder,
  type LibraryRange,
} from '@/core/meetings/library';
import type { CallView } from '@/core/review/calls';
import { callLengthText } from '@/features/review/CallsList';
import { LIVE_ELSEWHERE_LABEL } from '@/features/live/useLiveElsewhere';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/** A call row's date and time, in the user's locale (for example "17 Nov 2026, 14:05"). */
const CALL_WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Props for LibraryPane. */
export interface LibraryPaneProps {
  /** The whole library (filtered here), or undefined while it is read. */
  folders: LibraryFolder[] | undefined;
  /** The shown call's id, or null. */
  selectedId: string | null;
  /** Opens a call. */
  onSelect: (callId: string) => void;
  /** Something under the list (the desktop app: this computer's name). */
  footer?: ReactNode;
  /** ADR-0098: the sessions live on another device of the account. */
  liveElsewhere?: ReadonlySet<string>;
}

/** The attribute the arrow keys move between (folder buttons and call rows). */
const NAV_ATTRIBUTE = 'data-library-nav';

/**
 * Moves focus between the list's folders and calls with the arrow keys, Home and End.
 *
 * @param event The key press on the list.
 * Called from: LibraryPane (onKeyDown of the list)
 */
function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(`[${NAV_ATTRIBUTE}]`)];
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(items.length - 1, at + 1)
          : Math.max(0, at - 1);
  event.preventDefault();
  items[next]?.focus();
}

/**
 * One small mark on a call row.
 *
 * @param props.label The words for screen readers and the tooltip.
 * @param props.children The icon.
 * @returns The mark.
 * Rendered by: CallRow
 */
function Mark({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label} className="text-ui-muted">
      {children}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * One call in a folder.
 *
 * @param props.call     The call.
 * @param props.folder   Its folder (the session, for the other person's name).
 * @param props.selected True when it is shown.
 * @param props.onSelect Opens it.
 * @returns The row.
 * Rendered by: LibraryPane
 */
function CallRow({
  call,
  folder,
  selected,
  onSelect,
}: {
  /** The call. */
  call: CallView;
  /** Its folder. */
  folder: LibraryFolder;
  /** True when shown. */
  selected: boolean;
  /** Opens it. */
  onSelect: () => void;
}) {
  const marks = callMarks(call);
  const live = call.record !== null && call.record.phase !== 'ended';
  const them = callTheirName(folder.session, call);
  const icon = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;
  return (
    <li>
      <button
        type="button"
        {...{ [NAV_ATTRIBUTE]: '' }}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={[
          'flex w-full items-center gap-2 rounded-control py-2 pl-9 pr-3 text-left focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11',
          // As the sidebar marks its page: a quiet fill and the heading colour.
          selected
            ? 'bg-ui-subtle text-ui-heading shadow-[inset_2px_0_0_var(--ui-accent-fill)]'
            : 'text-ui-text hover:bg-ui-hover',
        ].join(' ')}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium">
            {CALL_WHEN.format(call.startedAt)}
          </span>
          {/* Muted text is under 4.5:1 on the selected row's fill (theme.css), so it uses the body colour. */}
          <span className={`truncate text-[12px] ${selected ? 'text-ui-text' : 'text-ui-muted'}`}>
            {live ? 'In progress' : callLengthText(call.durationMs)}
            {them ? ` · with ${them}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {marks.recorded && (
            <Mark label="Recorded">
              <Video {...icon} />
            </Mark>
          )}
          {marks.notes && (
            <Mark label="AI notes">
              <Sparkles {...icon} />
            </Mark>
          )}
          {marks.transcript && (
            <Mark label="Transcript">
              <FileText {...icon} />
            </Mark>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * The library pane.
 *
 * @param props See LibraryPaneProps.
 * @returns The pane.
 * Rendered by: MeetingsPage.tsx
 */
export function LibraryPane({
  folders,
  selectedId,
  onSelect,
  footer,
  liveElsewhere,
}: LibraryPaneProps) {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<LibraryRange>('all');
  // The person's own open / closed choices; otherwise the folder of the shown call (or the newest) is open.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  // The date filter's clock: read when the page opens and again whenever a date is chosen.
  const [now, setNow] = useState(() => Date.now());
  const shown = useMemo(
    () => (folders ? filterLibrary(folders, query, range, now) : []),
    [folders, query, range, now],
  );
  const searching = query.trim() !== '' || range !== 'all';

  /**
   * Whether a folder is open.
   * @param folder The folder.
   * @param index  Its place in the list.
   * @returns True when open.
   */
  const isOpen = (folder: LibraryFolder, index: number): boolean => {
    const own = toggled.get(folder.session.id);
    if (own !== undefined) return own;
    if (searching) return true;
    const holdsSelected = folder.calls.some((call) => call.id === selectedId);
    return holdsSelected || (selectedId === null && index === 0);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-ui-border p-3">
        <Input
          label="Search meetings"
          hideLabel
          type="search"
          placeholder="Search company, session or name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          end={<Search aria-hidden="true" size={16} strokeWidth={1.75} className="text-ui-muted" />}
        />
        <Select
          label="Date"
          hideLabel
          options={LIBRARY_RANGES}
          value={range}
          onChange={(value) => {
            setRange(value);
            setNow(Date.now());
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {folders === undefined && (
          <p role="status" className="px-2 py-6 text-center text-[13px] text-ui-muted">
            Loading your meetings…
          </p>
        )}
        {folders !== undefined && folders.length === 0 && (
          <p className="px-3 py-8 text-center text-[13px] text-ui-muted">
            No calls yet. Your calls appear here after you start a session.
          </p>
        )}
        {folders !== undefined && folders.length > 0 && shown.length === 0 && (
          <p role="status" className="px-3 py-8 text-center text-[13px] text-ui-muted">
            No meetings match. Try other words or another date.
          </p>
        )}
        {shown.length > 0 && (
          <ul aria-label="Session folders" className="flex flex-col gap-0.5" onKeyDown={moveFocus}>
            {shown.map((folder, index) => {
              const open = isOpen(folder, index);
              const listId = `folder-${folder.session.id}`;
              return (
                <li key={folder.session.id}>
                  <button
                    type="button"
                    {...{ [NAV_ATTRIBUTE]: '' }}
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() =>
                      setToggled((current) => new Map(current).set(folder.session.id, !open))
                    }
                    className="flex w-full items-center gap-1.5 rounded-control px-2 py-2 text-left text-ui-heading hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.75}
                      className={`shrink-0 text-ui-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                    />
                    <Folder
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.75}
                      className="shrink-0 text-ui-muted"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-semibold">{folder.name}</span>
                      {liveElsewhere?.has(folder.session.id) && (
                        <span className="flex items-center gap-1.5 text-[12px] font-normal text-ui-text">
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 animate-pulse rounded-full bg-ui-dot-recording"
                          />
                          {LIVE_ELSEWHERE_LABEL}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[12px] text-ui-muted">
                      {folder.calls.length}
                      <span className="sr-only">
                        {folder.calls.length === 1 ? ' call' : ' calls'}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <ul id={listId} aria-label={folder.name} className="flex flex-col gap-0.5 pb-1">
                      {folder.calls.map((call) => (
                        <CallRow
                          key={call.id}
                          call={call}
                          folder={folder}
                          selected={call.id === selectedId}
                          onSelect={() => onSelect(call.id)}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {footer && <div className="border-t border-ui-border px-3 py-2">{footer}</div>}
    </div>
  );
}
