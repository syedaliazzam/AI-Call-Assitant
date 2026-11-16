/**
 * File: apps/web/src/features/live/RenameOffer.tsx
 * Purpose: The call window's "Rename Them to Sarah?" line (ADR-0093): shown when the other person
 *          introduced themselves and no name was known, with Rename (one click, for the rest of the call)
 *          and Not now. The overlay shows the same offer on its status bar (overlay/statusLine.ts).
 * Used by: src/features/live/LivePage.tsx; tests/visual/rig-live.tsx
 * Depends on: src/ui/Button.tsx
 * Architecture: ADR-0093
 *
 * The name is shown on screen only; it is never logged.
 */
'use client';

import { Button } from '@/ui/Button';

/** Props for RenameOffer. */
export interface RenameOfferProps {
  /** The other person's label now ("Them" or "Interviewer"). */
  label: string;
  /** The name offered. */
  name: string;
  /** Rename: the live page renames them for the rest of the call. */
  onRename: (name: string) => void;
  /** Not now: the name is not offered again in this call. */
  onDismiss: () => void;
}

/**
 * The offer line.
 *
 * @param props See RenameOfferProps.
 * @returns The line.
 * Rendered by: LivePage.tsx (in the call's notices)
 */
export function RenameOffer({ label, name, onRename, onDismiss }: RenameOfferProps) {
  return (
    <div
      role="status"
      aria-label="Rename offer"
      className="flex items-center gap-2 rounded-control border border-ui-border bg-ui-surface px-3 py-2 text-[13px] text-ui-text"
    >
      <span className="min-w-0 flex-1">
        Rename {label} to {name}?
      </span>
      <Button size="sm" onClick={() => onRename(name)}>
        Rename
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Not now
      </Button>
    </div>
  );
}
