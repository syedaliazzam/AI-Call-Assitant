/**
 * File: apps/web/src/features/dashboard/SessionCard.tsx
 * Purpose: One session on the dashboard: date, an initial avatar, company, role or topic, type and
 *          transcript chips, a status dot, Start session or Review, and a ⋮ menu with Edit, Rename, Duplicate and Delete
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

/** Dot colour per shown status. */
const STATUS_DOTS: Record<SessionStatus, string> = {
  'not-started': 'bg-ui-muted',
  live: 'bg-ui-dot-success',
  ended: 'bg-ui-border',
};

/** The look shared by the small chips on a card. Text colour: muted is too faint on subtle. */
const CHIP = 'rounded-full bg-ui-subtle px-2.5 py-0.5 text-[13px] text-ui-text';

/** Date and time format for the card, in the user's locale (for example "28 Oct 2026, 14:05"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The first letter of a session's name, for its avatar.
 *
 * @param title The session's name.
 * @returns One capital letter.
 * Called from: SessionCard
 */
function initial(title: string): string {
  return title.trim().charAt(0).toUpperCase();
}

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
        'flex flex-col gap-4 rounded-card border border-ui-border bg-ui-surface p-5 shadow-card',
        grid ? 'justify-between' : 'md:flex-row md:items-center md:justify-between',
      ].join(' ')}
    >
      <div className="flex min-w-0 gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ui-subtle text-[15px] font-semibold text-ui-heading"
        >
          {initial(title)}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] text-ui-muted">{DATE_FORMAT.format(session.createdAt)}</p>
          <h2 className="truncate text-[15px] font-semibold text-ui-heading">{title}</h2>
          <p className="truncate text-[15px] text-ui-text">{session.role}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={CHIP}>{SESSION_TYPE_LABELS[session.type]}</span>
            {session.saveTranscript && <span className={CHIP}>Transcript</span>}
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ui-muted">
              <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOTS[status]}`} />
              {STATUS_LABELS[status]}
            </span>
          </div>
        </div>
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
