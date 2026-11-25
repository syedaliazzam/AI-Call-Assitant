/**
 * File: apps/web/src/features/live/overlay/WarningLine.tsx
 * Purpose: ADR-0118: the overlay's slim warning line, under the transcript bar (above it on the bottom-row
 *          positions). It shows the call's current message with its button ("Can't hear the other side ·
 *          Choose audio source", "Listening… · Cancel", "Private is off · Turn on") only while it applies,
 *          and nothing otherwise. Until ADR-0118 these messages replaced the live words on bar 2 (ADR-0082).
 *          Which message, and in which order, is still statusLine.ts.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/core/live/liveChannel.ts, ./parts.tsx, ./statusLine.ts
 * Architecture: ADR-0118 (amends ADR-0082); ADR-0069, ADR-0070, ADR-0085, ADR-0093
 *
 * Only the app's own messages (and, in the rename offer, the other person's name) are shown; nothing is logged.
 */
'use client';

import type { CompactCommand } from '@/core/live/liveChannel';
import { BUTTON } from './parts';
import type { StatusMessage } from './statusLine';

/** Each tone's text colour (the same as on bar 2 before ADR-0118). */
const TONE: Readonly<Record<StatusMessage['tone'], string>> = {
  alert: 'text-ui-warning',
  warning: 'text-ui-warning',
  listening: 'text-ui-danger',
  muted: 'text-ui-muted',
  offer: 'text-ui-text',
};

/** Props for WarningLine. */
export interface WarningLineProps {
  /** The message to show (statusMessage()). */
  message: StatusMessage;
  /** Sends a command to the live page (a message's button). */
  onCommand: (command: CompactCommand) => void;
  /** Opens a device list (a "can't hear" message's button). */
  onList: (list: 'audio' | 'mic') => void;
  /** Turns Private back on (a Private message's button). */
  onPrivateOn: () => void;
}

/**
 * The warning line: the message, its button and its second button (ADR-0093's "Not now"), in one slim row;
 * a long message wraps to a second line rather than being cut off.
 *
 * @param props See WarningLineProps.
 * @returns The line.
 * Rendered by: CompactView.tsx
 */
export function WarningLine({ message, onCommand, onList, onPrivateOn }: WarningLineProps) {
  const action = message.action;
  return (
    <div
      role="group"
      aria-label="Call message"
      data-status={message.key}
      className="flex min-h-9 items-center gap-2 px-3 py-1 text-[13px] [-webkit-app-region:no-drag]"
    >
      <span
        role={message.tone === 'alert' ? 'alert' : 'status'}
        className={`line-clamp-2 min-w-0 flex-1 ${TONE[message.tone]}`}
        // ADR-0085: words for screen readers (no title: its tooltip is an unprotected window). A spread,
        // as jsx-a11y's role list predates ARIA 1.3's aria-description (Chromium reads it).
        {...{ 'aria-description': message.detail ?? message.text }}
      >
        {message.text}
      </span>
      {action && (
        <button
          type="button"
          // It opens a device list, a popup (the marker only; ADR-0105: a press on it while the list is open
          // closes the list).
          {...(action.kind === 'list' ? { 'data-popup-button': '' } : {})}
          className={`${BUTTON} h-6 shrink-0 text-[13px]`}
          onClick={() => {
            if (action.kind === 'command') onCommand(action.command);
            else if (action.kind === 'list') onList(action.list);
            else onPrivateOn();
          }}
        >
          {action.label}
        </button>
      )}
      {message.dismiss && (
        <button
          type="button"
          className={`${BUTTON} h-6 shrink-0 text-[13px]`}
          onClick={() => onCommand(message.dismiss!.command)}
        >
          {message.dismiss.label}
        </button>
      )}
    </div>
  );
}
