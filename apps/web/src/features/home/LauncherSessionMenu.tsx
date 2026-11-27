/**
 * File: apps/web/src/features/home/LauncherSessionMenu.tsx
 * Purpose: The ⋮ menu of a session card in the desktop app's "Your sessions" (ADR-0071): View in
 *          dashboard ↗ (the session's page in the browser), Duplicate (ADR-0129: "Copy of <name>" with the
 *          setup only, the same as the dashboard's) and Delete, which asks first. Editing and renaming stay in
 *          the dashboard.
 * Used by: src/features/home/LauncherSessions.tsx
 * Depends on: src/core/storage/types.ts, src/features/sync/dashboardLink.ts, src/ui (Button, Dialog,
 *             Menu, icons)
 * Architecture: ADR-0055, ADR-0071
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { useState } from 'react';
import type { Session } from '@/core/storage/types';
import { openDashboard } from '@/features/sync/dashboardLink';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { MoreIcon } from '@/ui/icons';
import { Menu } from '@/ui/Menu';

/** Props for LauncherSessionMenu. */
export interface LauncherSessionMenuProps {
  /** The session. */
  session: Session;
  /** Its name, as the card shows it. */
  title: string;
  /** Deletes it, after the user has confirmed (the account copy goes too, through account sync). */
  onDelete: (session: Session) => Promise<void>;
  /** ADR-0129: copies its setup as "Copy of <name>" (the copy appears in the list by itself). */
  onDuplicate: (session: Session) => Promise<void>;
}

/**
 * The menu and its Delete dialog.
 *
 * @param props See LauncherSessionMenuProps.
 * @returns The ⋮ button, with its menu and dialog.
 * Rendered by: LauncherSessions.tsx (one per card)
 */
export function LauncherSessionMenu({
  session,
  title,
  onDelete,
  onDuplicate,
}: LauncherSessionMenuProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** Deletes the session after confirmation, then closes the dialog. */
  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete(session);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <Menu
        label={<MoreIcon />}
        ariaLabel={`More for ${title}`}
        variant="plain"
        size="icon"
        items={[
          {
            label: 'View in dashboard',
            // The arrow says it opens in the browser, as the window's other dashboard links do.
            detail: '↗',
            onSelect: () => openDashboard(`/sessions/${session.id}`),
          },
          { label: 'Duplicate', onSelect: () => void onDuplicate(session) },
          { label: 'Delete', danger: true, onSelect: () => setConfirming(true) },
        ]}
      />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this session?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          “{title}” and everything saved with it (documents, transcript, answers, notes) will be
          deleted from your account, here and in the browser. This cannot be undone.
        </p>
      </Dialog>
    </>
  );
}
