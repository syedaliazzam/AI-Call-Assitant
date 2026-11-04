/**
 * File: apps/web/src/features/dashboard/SessionCard.tsx
 * Purpose: One session on the sessions page (spec S3). As a card: an outer edge (radius 20, padding 8)
 *          around a grey inner panel (radius 16) with the date, ⋮, letter tile, title, role and chips;
 *          under it the status dot and word, what happened in the call, and Start session or View
 *          transcript. As a row in the list view: the same data on one line.
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: lucide-react, src/core/storage (types, shownStatus), src/ui (Button, Chip, LinkButton),
 *             ./SessionMenu.tsx, ./sessionCardParts.ts, src/features/session-setup/labels.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S3)
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { Bot, Briefcase, MessagesSquare, Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { shownStatus } from '@/core/storage/sessions';
import type { Session, SessionStatus, SessionType } from '@/core/storage/types';
import { SESSION_TYPE_LABELS, STATUS_LABELS } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { LinkButton } from '@/ui/LinkButton';
import {
  letterTile,
  sessionCardLine,
  sessionCardTitle,
  sessionUsageLine,
} from './sessionCardParts';
import { SessionMenu } from './SessionMenu';

/** Props for SessionCard. */
export interface SessionCardProps {
  /** The session to show. */
  session: Session;
  /** Current time in Unix ms (for the shown status; passed in so all cards agree). */
  now: number;
  /** True in the grid layout; false for one row per session. */
  grid: boolean;
  /** How many answers the session has. */
  answers: number;
  /** Called when the user starts the session. */
  onOpen: (session: Session) => void;
  /** Called after the user confirmed deleting the session. */
  onDelete: (session: Session) => Promise<void>;
  /** Saves a new company and role or topic. */
  onRename: (session: Session, company: string, role: string) => Promise<void>;
  /** Copies the session. */
  onDuplicate: (session: Session) => Promise<void>;
}

/** The status dot per shown status (spec §1): accent, a red pulse, or grey. */
const STATUS_DOTS: Record<SessionStatus, string> = {
  'not-started': 'bg-ui-accent-fill',
  live: 'animate-pulse bg-ui-dot-recording',
  ended: 'bg-ui-dot-ended',
};

/** The icon of each session type's chip. */
const TYPE_ICONS: Record<SessionType, typeof Briefcase> = {
  interview: Briefcase,
  regular: Phone,
  mock: Bot,
};

/** The date on a card, in the user's locale (shown uppercase, for example "NOV 4, 2026"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The letter tile (24 px): the first letter on a colour worked out from the name.
 *
 * @param props.name The name on the card.
 * @returns The tile.
 * Rendered by: SessionCard
 */
function LetterTile({
  name,
}: {
  /** The name on the card. */
  name: string;
}) {
  const { letter, colour } = letterTile(name);
  return (
    <span
      aria-hidden="true"
      // The colour is a token chosen by number, so the theme holds every value.
      style={{ backgroundColor: `var(--k-tile-${colour})` }}
      className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[13px] font-semibold text-ui-on-accent"
    >
      {letter}
    </span>
  );
}

/**
 * One session.
 *
 * @param props See SessionCardProps.
 * @returns The card or row.
 * Rendered by: Dashboard.tsx (one per listed session)
 */
export function SessionCard({
  session,
  now,
  grid,
  answers,
  onOpen,
  onDelete,
  onRename,
  onDuplicate,
}: SessionCardProps) {
  const router = useRouter();
  const status = shownStatus(session, now);
  const title = sessionCardTitle(session);
  const line = sessionCardLine(session);
  const TypeIcon = TYPE_ICONS[session.type];

  const date = (
    <p className="text-card-date uppercase text-ui-muted">
      {DATE_FORMAT.format(session.createdAt)}
    </p>
  );
  const menu = (
    <SessionMenu
      session={session}
      title={title}
      onOpen={onOpen}
      onEdit={(target) => router.push(`/sessions/${target.id}/edit`)}
      onRename={onRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );
  const name = (
    <div className="flex min-w-0 items-center gap-2">
      <LetterTile name={title} />
      <h2 className="truncate text-card-title text-ui-heading">{title}</h2>
    </div>
  );
  const role = line && <p className="truncate text-card-role text-ui-muted">{line}</p>;
  const chips = (
    <div className="flex flex-wrap gap-1.5">
      <Chip icon={<TypeIcon aria-hidden="true" size={14} strokeWidth={1.75} />}>
        {SESSION_TYPE_LABELS[session.type]}
      </Chip>
      {session.saveTranscript && (
        <Chip icon={<MessagesSquare aria-hidden="true" size={14} strokeWidth={1.75} />}>
          Transcript
        </Chip>
      )}
    </div>
  );
  const statusLines = (
    <div className="min-w-0">
      <p
        className={`flex items-center gap-2 text-[15px] ${status === 'ended' ? 'text-ui-muted' : 'text-ui-heading'}`}
      >
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${STATUS_DOTS[status]}`}
        />
        {STATUS_LABELS[status]}
      </p>
      <p className="truncate text-card-role text-ui-muted">
        {sessionUsageLine(session, status, answers)}
      </p>
    </div>
  );
  const action =
    status === 'ended' ? (
      <LinkButton href={`/sessions/${session.id}`} variant="secondary" className="shrink-0">
        View transcript
      </LinkButton>
    ) : (
      <Button variant="secondary" className="shrink-0" onClick={() => onOpen(session)}>
        Start session
      </Button>
    );

  if (!grid) {
    return (
      <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-ui-border bg-ui-bg px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          {name}
          {role}
        </div>
        <div className="hidden lg:block">{chips}</div>
        <div className="w-28 max-sm:hidden">{date}</div>
        <div className="w-40">{statusLines}</div>
        {action}
        {menu}
      </li>
    );
  }

  return (
    <li className="flex min-w-0 flex-col rounded-session border border-ui-border bg-ui-bg p-2">
      <div className="flex flex-1 flex-col gap-1.5 rounded-card bg-ui-panel px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          {date}
          {menu}
        </div>
        {name}
        {role}
        <div className="mt-2.5">{chips}</div>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        {statusLines}
        {action}
      </div>
    </li>
  );
}
