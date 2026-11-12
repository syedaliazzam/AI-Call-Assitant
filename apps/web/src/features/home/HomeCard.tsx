/**
 * File: apps/web/src/features/home/HomeCard.tsx
 * Purpose: One session on the home panel (v1.1.0, ADR-0041): date, title, description and ⋮; the type
 *          and Transcript chips; the status dot and word, the latest call's length, and "View
 *          transcript" and "Start again" (ADR-0073) for an ended session, or "Start" for one that is ready.
 * Used by: src/features/home/HomePanel.tsx
 * Depends on: src/core/session/callLength.ts, src/core/storage (sessions.ts, types.ts),
 *             src/features/dashboard/SessionMenu.tsx, src/features/session-setup/labels.ts, src/ui
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { callLength } from '@/core/session/callLength';
import { shownStatus } from '@/core/storage/sessions';
import type { Session, SessionStatus } from '@/core/storage/types';
import { SessionMenu } from '@/features/dashboard/SessionMenu';
import { SESSION_TYPE_LABELS, STATUS_LABELS } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';

/** The date as a card shows it, for example "28 Oct 2026". */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Dot colour per shown status. */
const STATUS_DOTS: Record<SessionStatus, string> = {
  'not-started': 'bg-ui-dot-success',
  live: 'bg-ui-dot-success',
  ended: 'bg-ui-muted',
};

/** The look shared by the card's chips. */
const CHIP = 'rounded-full bg-ui-subtle px-2.5 py-0.5 text-[12px] text-ui-text';

/**
 * A card's title.
 *
 * @param session The session.
 * @returns The company, or "<Type> call" when it has none.
 * Called from: HomeCard, HomePanel.tsx (search); tests
 */
export function homeCardTitle(session: Pick<Session, 'company' | 'type'>): string {
  return session.company.trim() || `${SESSION_TYPE_LABELS[session.type]} call`;
}

/**
 * A card's description.
 *
 * @param session The session.
 * @returns The role or topic, or the description's first line.
 * Called from: HomeCard, HomePanel.tsx (search); tests
 */
export function homeCardDescription(session: Pick<Session, 'role' | 'description'>): string {
  return session.role.trim() || (session.description.trim().split('\n')[0] ?? '');
}

/** Props for HomeCard. */
export interface HomeCardProps {
  /** The session. */
  session: Session;
  /** The time now (Unix ms), passed in so every card judges "live" the same way. */
  now: number;
  /** Starts the session. */
  onStart: (session: Session) => void;
  /** Opens its review. */
  onView: (session: Session) => void;
  /** Opens its details for editing. */
  onEdit: (session: Session) => void;
  /** Saves a new company and role or topic. */
  onRename: (session: Session, company: string, role: string) => Promise<void>;
  /** Copies it. */
  onDuplicate: (session: Session) => Promise<void>;
  /** Deletes it. */
  onDelete: (session: Session) => Promise<void>;
  /**
   * True in the launcher (ADR-0051, account sync): Start only; changes are made in the dashboard,
   * so the card has no menu.
   */
  launcher?: boolean;
}

/**
 * One card.
 *
 * @param props See HomeCardProps.
 * @returns The card.
 * Rendered by: HomePanel.tsx
 */
export function HomeCard(props: HomeCardProps) {
  const { session } = props;
  const status = shownStatus(session, props.now);
  const title = homeCardTitle(session);
  const description = homeCardDescription(session);
  const length = callLength(session.lastCallMs);
  return (
    <li className="rounded-card border border-ui-border bg-ui-surface p-1.5 shadow-card">
      <div className="rounded-control bg-ui-subtle px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="pt-1 text-[12px] uppercase tracking-wide text-ui-muted">
            {DATE_FORMAT.format(session.createdAt)}
          </p>
          {!props.launcher && (
            <SessionMenu
              session={session}
              title={title}
              onOpen={props.onStart}
              onEdit={props.onEdit}
              onRename={props.onRename}
              onDuplicate={props.onDuplicate}
              onDelete={props.onDelete}
            />
          )}
        </div>
        <h2 className="truncate text-[15px] font-semibold text-ui-heading">{title}</h2>
        {description && <p className="truncate text-[13px] text-ui-text">{description}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={`${CHIP} bg-ui-surface`}>{SESSION_TYPE_LABELS[session.type]}</span>
          {session.saveTranscript && <span className={`${CHIP} bg-ui-surface`}>Transcript</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ui-text">
            <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOTS[status]}`} />
            {STATUS_LABELS[status]}
          </p>
          {length && <p className="text-[12px] text-ui-muted">{length}</p>}
        </div>
        {status === 'ended' ? (
          // ADR-0073: an ended session starts again too, each start a new call in the same session.
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => props.onView(session)}>
              View transcript
            </Button>
            <Button size="sm" variant="secondary" onClick={() => props.onStart(session)}>
              Start again
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => props.onStart(session)}>
            Start
          </Button>
        )}
      </div>
    </li>
  );
}
