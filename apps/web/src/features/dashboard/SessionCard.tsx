/**
 * File: apps/web/src/features/dashboard/SessionCard.tsx
 * Purpose: One session on the dashboard: date, company, role or topic, type and transcript chips,
 *          status, Start session or Review, and a ⋮ menu with Edit, Rename, Duplicate and Delete
 *          (Delete asks for confirmation first).
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: src/core/storage (types, shownStatus), src/ui (Button, Dialog, Input, LinkButton,
 *             Menu, icons), src/features/session-setup/labels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1), §5 (Dashboard); ADR-0029
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { shownStatus } from '@/core/storage/sessions';
import type { Session, SessionStatus } from '@/core/storage/types';
import { SESSION_TYPE_LABELS, STATUS_LABELS } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { MoreIcon } from '@/ui/icons';
import { Input } from '@/ui/Input';
import { LinkButton } from '@/ui/LinkButton';
import { Menu } from '@/ui/Menu';

/** Props for SessionCard. */
export interface SessionCardProps {
  /** The session to show. */
  session: Session;
  /** Current time in Unix ms (for the shown status; passed in so all cards agree). */
  now: number;
  /** True in the grid layout: the card stacks its parts. */
  grid: boolean;
  /** Called when the user starts the session. */
  onOpen: (session: Session) => void;
  /** Called after the user confirmed deleting the session. */
  onDelete: (session: Session) => Promise<void>;
  /** Saves a new company and role or topic. */
  onRename: (session: Session, company: string, role: string) => Promise<void>;
  /** Copies the session. */
  onDuplicate: (session: Session) => Promise<void>;
}

/** Badge colours per shown status. */
const STATUS_CLASSES: Record<SessionStatus, string> = {
  'not-started': 'bg-ui-band text-ui-text',
  live: 'bg-ui-success-bg text-ui-success',
  ended: 'bg-ui-band text-ui-muted',
};

/** The look shared by the small chips on a card. */
const CHIP = 'px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em]';

/** Date and time format for the card, in the user's locale (for example "28 Oct 2026, 14:05"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * One session card.
 *
 * @param props See SessionCardProps.
 * @returns The card, with its rename and delete dialogs.
 * Rendered by: Dashboard.tsx (one per listed session)
 */
export function SessionCard({
  session,
  now,
  grid,
  onOpen,
  onDelete,
  onRename,
  onDuplicate,
}: SessionCardProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [company, setCompany] = useState(session.company);
  const [role, setRole] = useState(session.role);
  const status = shownStatus(session, now);
  const title = session.company || 'Untitled session';
  const ended = status === 'ended';

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
    <li
      className={[
        'flex flex-col gap-4 border border-ui-border bg-ui-surface p-5',
        grid ? 'justify-between' : 'md:flex-row md:items-center md:justify-between',
      ].join(' ')}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-[17px] font-semibold text-ui-heading">{title}</h2>
          <span className={`bg-ui-pale text-ui-subheading ${CHIP}`}>
            {SESSION_TYPE_LABELS[session.type]}
          </span>
          {session.saveTranscript && (
            <span className={`bg-ui-band text-ui-muted ${CHIP}`}>Transcript</span>
          )}
          <span className={`${CHIP} ${STATUS_CLASSES[status]}`}>{STATUS_LABELS[status]}</span>
        </div>
        <p className="mt-1 truncate text-[15px] text-ui-text">{session.role}</p>
        <p className="mt-1 font-mono text-[12px] text-ui-muted">
          {DATE_FORMAT.format(session.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {ended ? (
          // Day 5 Stage 6: notes, answers and transcript of an ended session.
          <LinkButton href={`/sessions/${session.id}`} size="sm">
            Review
          </LinkButton>
        ) : (
          <Button size="sm" onClick={() => onOpen(session)}>
            Start session
          </Button>
        )}
        <Menu
          label={<MoreIcon />}
          ariaLabel={`More for ${title}`}
          variant="ghost"
          items={[
            ...(ended ? [{ label: 'Start again', onSelect: () => onOpen(session) }] : []),
            { label: 'Edit', onSelect: () => router.push(`/sessions/${session.id}/edit`) },
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
      </div>

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
    </li>
  );
}
