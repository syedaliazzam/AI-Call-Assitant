/**
 * File: apps/web/src/features/dashboard/SessionCard.tsx
 * Purpose: One session on the sessions page (spec S3). As a card: an outer edge (radius 20, padding 8)
 *          around a grey inner panel (radius 16) with the date, ⋮, logo or letter tile, title, role and chips;
 *          under it the status dot and word, what happened in the call, and Start session or View
 *          transcript. As a row in the list view: the same data on one line. ADR-0071: the card itself
 *          (SessionCardFrame) is shared with the desktop app's "Your sessions", which gives it its own
 *          menu and button. ADR-0098: a session live on another device of the account shows "Live on
 *          another device" (a red dot), its Start disabled with that tooltip, and Take over.
 * Used by: src/features/dashboard/Dashboard.tsx, src/features/home/LauncherSessions.tsx (SessionCardFrame)
 * Depends on: lucide-react, src/core/storage (types, shownStatus), src/ui (Button, Chip, LinkButton),
 *             ./CompanyTile.tsx, ./SessionMenu.tsx, ./sessionCardParts.ts,
 *             src/features/session-setup/labels.ts, src/features/live (TakeOver.tsx, useLiveElsewhere.ts)
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S3); ADR-0057, ADR-0071, ADR-0098
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { DriveSessionStatus } from '@/features/drive/DriveSessionStatus';
import { Bot, Briefcase, MessagesSquare, Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { shownStatus } from '@/core/storage/sessions';
import type { Session, SessionStatus, SessionType } from '@/core/storage/types';
import { TakeOverButtons } from '@/features/live/TakeOver';
import { LIVE_ELSEWHERE_LABEL } from '@/features/live/useLiveElsewhere';
import { SESSION_TYPE_LABELS, STATUS_LABELS } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { LinkButton } from '@/ui/LinkButton';
import { CompanyTile } from './CompanyTile';
import { sessionCardLine, sessionCardTitle, sessionUsageLine } from './sessionCardParts';
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
  /** ADR-0098: true while the session is live on another device of the account. */
  liveElsewhere?: boolean;
  /** ADR-0098: the user confirmed Take over (the session then starts here). */
  onTakeOver?: (session: Session) => void;
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
  liveElsewhere = false,
  onTakeOver,
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
      liveElsewhere={liveElsewhere}
      onEdit={(target) => router.push(`/sessions/${target.id}/edit`)}
      onRename={onRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );
  const name = (
    <div className="flex min-w-0 items-center gap-2">
      <CompanyTile name={title} domain={session.companyDomain} />
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
    <SessionStatusLines
      session={session}
      status={status}
      answers={answers}
      liveElsewhere={liveElsewhere}
    />
  );
  const viewTranscript = (
    <LinkButton href={`/sessions/${session.id}`} variant="secondary" className="shrink-0">
      View transcript
    </LinkButton>
  );
  // ADR-0098: live on another device: Start is disabled (Start again is in ⋮, disabled there), and Take
  // over asks first. The transcript stays one click away.
  const takeOver = (
    <TakeOverButtons
      startLabel="Start session"
      name={[title, line].filter(Boolean).join(', ')}
      showStart={status !== 'ended'}
      onTakeOver={() => onTakeOver?.(session)}
    />
  );
  const action = liveElsewhere ? (
    <div className="flex shrink-0 flex-wrap justify-end gap-2">
      {status === 'ended' && viewTranscript}
      {takeOver}
    </div>
  ) : status === 'ended' ? (
    viewTranscript
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
    <SessionCardFrame
      session={session}
      status={status}
      answers={answers}
      liveElsewhere={liveElsewhere}
      menu={menu}
      action={action}
    />
  );
}

/** Props for SessionCardFrame. */
export interface SessionCardFrameProps {
  /** The session to show. */
  session: Session;
  /** Its shown status (worked out once by the caller, so all cards agree on the clock). */
  status: SessionStatus;
  /** How many answers it has. */
  answers: number;
  /** The ⋮ menu at the top right of the inner panel. */
  menu: ReactNode;
  /** The button at the bottom right (Start session, View transcript). */
  action: ReactNode;
  /** A small green line above the date (the desktop's "From your browser"). */
  eyebrow?: string;
  /** True to edge the card in green (the session the browser's link opened). */
  highlighted?: boolean;
  /** ADR-0098: true while the session is live on another device ("Live on another device"). */
  liveElsewhere?: boolean;
}

/**
 * The session card (spec S3, v1.3.0 ADR-0057): an outer edge (radius 48, 1 px border, padding 8/8/12)
 * around a grey inner panel (radius 32, padding 12, a light shadow) with the date, ⋮, the logo tile and
 * title, the role and the chips; under it the status dot and word, the usage line, and a button.
 *
 * @param props See SessionCardFrameProps.
 * @returns The card, as a list item.
 * Rendered by: SessionCard (the sessions page's grid), LauncherSessions.tsx (the desktop app)
 */
export function SessionCardFrame({
  session,
  status,
  answers,
  menu,
  action,
  eyebrow,
  highlighted = false,
  liveElsewhere = false,
}: SessionCardFrameProps) {
  const title = sessionCardTitle(session);
  const line = sessionCardLine(session);
  const TypeIcon = TYPE_ICONS[session.type];
  return (
    <li
      className={`k-hover-lift flex min-w-0 flex-col rounded-session border bg-ui-bg px-2 pb-3 pt-2 ${
        highlighted ? 'border-ui-accent-fill [border-width:1.5px]' : 'border-ui-border'
      }`}
    >
      <div className="flex flex-1 flex-col gap-1.5 rounded-session-panel bg-ui-panel p-3 shadow-panel">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {eyebrow && <p className="text-[12px] font-medium text-ui-link">{eyebrow}</p>}
            <p className="text-card-date uppercase text-ui-muted">
              {DATE_FORMAT.format(session.createdAt)}
            </p>
          </div>
          {menu}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <CompanyTile name={title} domain={session.companyDomain} />
          <h2 className="truncate text-card-title text-ui-heading">{title}</h2>
        </div>
        {line && <p className="truncate text-card-role text-ui-muted">{line}</p>}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip icon={<TypeIcon aria-hidden="true" size={14} strokeWidth={1.75} />}>
            {SESSION_TYPE_LABELS[session.type]}
          </Chip>
          {session.saveTranscript && (
            <Chip icon={<MessagesSquare aria-hidden="true" size={14} strokeWidth={1.75} />}>
              Transcript
            </Chip>
          )}
        </div>
        {/* 1.6.0 (ADR-0072): this device's Google Drive upload, when it saves this session. */}
        <DriveSessionStatus sessionId={session.id} canUpload={session.lastActiveAt !== null} />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <SessionStatusLines
          session={session}
          status={status}
          answers={answers}
          liveElsewhere={liveElsewhere}
        />
        {action}
      </div>
    </li>
  );
}

/**
 * The status dot and word, and the muted usage line under them ("4m 26s · 12 answers").
 *
 * @param props.session The session.
 * @param props.status  Its shown status.
 * @param props.answers How many answers it has.
 * @param props.liveElsewhere ADR-0098: true while it is live on another device (a red dot and those words).
 * @returns The two lines.
 * Rendered by: SessionCard (list rows), SessionCardFrame
 */
function SessionStatusLines({
  session,
  status,
  answers,
  liveElsewhere,
}: {
  /** The session. */
  session: Session;
  /** Its shown status. */
  status: SessionStatus;
  /** How many answers it has. */
  answers: number;
  /** True while it is live on another device. */
  liveElsewhere: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={`flex items-center gap-2 text-[15px] ${status === 'ended' && !liveElsewhere ? 'text-ui-muted' : 'text-ui-heading'}`}
      >
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${liveElsewhere ? STATUS_DOTS.live : STATUS_DOTS[status]}`}
        />
        {liveElsewhere ? LIVE_ELSEWHERE_LABEL : STATUS_LABELS[status]}
      </p>
      <p className="truncate text-card-role text-ui-muted">
        {sessionUsageLine(session, status, answers)}
      </p>
    </div>
  );
}
