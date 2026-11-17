/**
 * File: apps/web/src/features/live/TakeOver.tsx
 * Purpose: The live-call lock's controls (ADR-0098) for a session live on another device of the account:
 *          the take-over confirmation ("This ends the call on the other device and starts it here."), and
 *          the session card's buttons: Start (or Start again) disabled with the tooltip "Live on another
 *          device", and Take over, which asks first.
 * Used by: src/features/dashboard/SessionCard.tsx, src/features/home/LauncherSessions.tsx (TakeOverButtons);
 *          src/features/live/LivePage.tsx, src/features/home/LauncherConnect.tsx (TakeOverDialog)
 * Depends on: react, src/ui (Button, Dialog, Tooltip), ./useLiveElsewhere.ts
 * Architecture: docs/decisions/ADR-0098-live-call-lock.md
 */
'use client';

import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Tooltip } from '@/ui/Tooltip';
import { LIVE_ELSEWHERE_LABEL } from './useLiveElsewhere';

/** The confirmation's sentence (the product's wording). */
export const TAKE_OVER_TEXT = 'This ends the call on the other device and starts it here.';

/** Props for TakeOverDialog. */
export interface TakeOverDialogProps {
  /** True to show it. */
  open: boolean;
  /** Closes it without taking over. */
  onCancel: () => void;
  /** The person confirmed: take the call over. Runs inside the click (the overlay may open from it). */
  onConfirm: () => void;
}

/**
 * Asks before a take-over.
 *
 * @param props See TakeOverDialogProps.
 * @returns The dialog.
 * Rendered by: TakeOverButtons, LivePage.tsx (Connect view), LauncherConnect.tsx
 */
export function TakeOverDialog({ open, onCancel, onConfirm }: TakeOverDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Take over this call?"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Take over</Button>
        </>
      }
    >
      <p className="text-[15px] text-ui-text">{TAKE_OVER_TEXT}</p>
    </Dialog>
  );
}

/** Props for TakeOverButtons. */
export interface TakeOverButtonsProps {
  /** The disabled start button's words: 'Start session' or 'Start again'. */
  startLabel: string;
  /** The session's name for screen readers (the card's title and line). */
  name: string;
  /** False when the card has no start button (the dashboard's ended session: Start again is in ⋮). */
  showStart?: boolean;
  /** Confirmed: leave the take-over note and open the session's start (its Connect card). */
  onTakeOver: () => void;
}

/**
 * A live-elsewhere card's buttons: the disabled start with its tooltip, and Take over (asks first).
 *
 * @param props See TakeOverButtonsProps.
 * @returns The two buttons and the dialog.
 * Rendered by: SessionCard.tsx, LauncherSessions.tsx
 */
export function TakeOverButtons({
  startLabel,
  name,
  showStart = true,
  onTakeOver,
}: TakeOverButtonsProps) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      {showStart && (
        <Tooltip content={LIVE_ELSEWHERE_LABEL} className="shrink-0">
          <Button
            variant="secondary"
            className="shrink-0"
            disabled
            aria-label={`${startLabel}: ${name} (${LIVE_ELSEWHERE_LABEL.toLowerCase()})`}
          >
            {startLabel}
          </Button>
        </Tooltip>
      )}
      <Button
        variant="secondary"
        className="shrink-0"
        aria-label={`Take over: ${name}`}
        onClick={() => setAsking(true)}
      >
        Take over
      </Button>
      <TakeOverDialog
        open={asking}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onTakeOver();
        }}
      />
    </>
  );
}
