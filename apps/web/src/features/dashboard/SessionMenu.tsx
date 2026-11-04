/**
 * File: apps/web/src/features/dashboard/SessionMenu.tsx
 * Purpose: A session's ⋮ menu with its rename and delete dialogs: Start again (once ended), Edit,
 *          Rename, Duplicate and Delete (which asks first). Shared by the dashboard's cards and the
 *          home panel's (v1.1.0).
 * Used by: src/features/dashboard/SessionCard.tsx, src/features/home/HomeCard.tsx
 * Depends on: src/core/storage (types, shownStatus), src/ui (Button, Dialog, Input, Menu, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Dashboard); ADR-0029, ADR-0041
 */
'use client';

import { useState } from 'react';
import { shownStatus } from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { MoreIcon } from '@/ui/icons';
import { Input } from '@/ui/Input';
import { Menu } from '@/ui/Menu';

/** Props for SessionMenu. */
export interface SessionMenuProps {
  /** The session. */
  session: Session;
  /** Its name, as the card shows it. */
  title: string;
  /** Starts it. */
  onOpen: (session: Session) => void;
  /** Opens its details for editing. */
  onEdit: (session: Session) => void;
  /** Saves a new company and role or topic. */
  onRename: (session: Session, company: string, role: string) => Promise<void>;
  /** Copies it. */
  onDuplicate: (session: Session) => Promise<void>;
  /** Deletes it, after the user has confirmed. */
  onDelete: (session: Session) => Promise<void>;
}

/**
 * The menu and its dialogs.
 *
 * @param props See SessionMenuProps.
 * @returns The ⋮ button, with its menu and dialogs.
 * Rendered by: SessionCard.tsx, HomeCard.tsx
 */
export function SessionMenu({
  session,
  title,
  onOpen,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
}: SessionMenuProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [company, setCompany] = useState(session.company);
  const [role, setRole] = useState(session.role);
  const ended = shownStatus(session) === 'ended';

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

  /** Saves the new names, then closes the dialog. */
  async function saveRename() {
    if (company.trim() === '' || role.trim() === '') return;
    await onRename(session, company.trim(), role.trim());
    setRenaming(false);
  }

  return (
    <>
      <Menu
        label={<MoreIcon />}
        ariaLabel={`More for ${title}`}
        variant="ghost"
        items={[
          ...(ended ? [{ label: 'Start again', onSelect: () => onOpen(session) }] : []),
          { label: 'Edit', onSelect: () => onEdit(session) },
          {
            label: 'Rename',
            onSelect: () => {
              setCompany(session.company);
              setRole(session.role);
              setRenaming(true);
            },
          },
          { label: 'Duplicate', onSelect: () => void onDuplicate(session) },
          { label: 'Delete', danger: true, onSelect: () => setConfirming(true) },
        ]}
      />

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename this session"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveRename()}
              disabled={company.trim() === '' || role.trim() === ''}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            maxLength={200}
          />
          <Input
            label={session.type === 'regular' ? 'Topic' : 'Role'}
            value={role}
            onChange={(event) => setRole(event.target.value)}
            maxLength={200}
          />
        </div>
      </Dialog>

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
          “{title}” and everything saved with it on this computer (documents, transcript, answers,
          notes) will be deleted. This cannot be undone.
        </p>
      </Dialog>
    </>
  );
}
