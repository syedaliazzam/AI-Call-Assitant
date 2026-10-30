/**
 * File: apps/web/src/features/dashboard/SessionCard.tsx
 * Purpose: One session on the dashboard: date, company, role or topic, type and status, with
 *          Review (ended sessions, Day 5), Open, Edit and Delete (Delete asks for confirmation
 *          first).
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: src/core/storage (types, shownStatus), src/ui (Button, Dialog),
 *             src/features/session-setup/labels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1), §5 (Dashboard);
 *               day-03-sessions.md Stage 3
 */
'use client';

import { useState } from 'react';
import { shownStatus } from '@/core/storage/sessions';
import type { Session, SessionStatus } from '@/core/storage/types';
import { SESSION_TYPE_LABELS, STATUS_LABELS } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { LinkButton } from '@/ui/LinkButton';

/** Props for SessionCard. */
export interface SessionCardProps {
  /** The session to show. */
  session: Session;
  /** Current time in Unix ms (for the shown status; passed in so all cards agree). */
  now: number;
  /** Called when the user opens the session. */
  onOpen: (session: Session) => void;
  /** Called after the user confirmed deleting the session. */
  onDelete: (session: Session) => Promise<void>;
}

/** Badge colours per shown status. */
const STATUS_CLASSES: Record<SessionStatus, string> = {
  'not-started': 'bg-ui-band text-ui-text',
  live: 'bg-ui-success-bg text-ui-success',
  ended: 'bg-ui-band text-ui-muted',
};

/** Date and time format for the card, in the user's locale (for example "28 Oct 2026, 14:05"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * One session card.
 *
 * @param props See SessionCardProps.
 * @returns The card, with its delete confirmation dialog.
 * Rendered by: Dashboard.tsx (one per listed session)
 */
export function SessionCard({ session, now, onOpen, onDelete }: SessionCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const status = shownStatus(session, now);
  const title = session.company || 'Untitled session';

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
    <li className="flex flex-col gap-4 border border-ui-border bg-ui-surface p-5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-[17px] font-semibold text-ui-heading">{title}</h2>
          <span className="bg-ui-pale px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-subheading">
            {SESSION_TYPE_LABELS[session.type]}
          </span>
          <span
            className={`px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${STATUS_CLASSES[status]}`}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>
        <p className="mt-1 truncate text-[15px] text-ui-text">{session.role}</p>
        <p className="mt-1 font-mono text-[12px] text-ui-muted">
          {DATE_FORMAT.format(session.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {status === 'ended' && (
          // Day 5 Stage 6: notes, answers and transcript of an ended session.
          <LinkButton href={`/sessions/${session.id}`} size="sm">
            Review
          </LinkButton>
        )}
        <Button size="sm" onClick={() => onOpen(session)}>
          Open
        </Button>
        <LinkButton href={`/sessions/${session.id}/edit`} size="sm">
          Edit
        </LinkButton>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      </div>

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
