/**
 * File: apps/web/src/features/home/LauncherStart.tsx
 * Purpose: The desktop app's "Start your session" card (reference "first desktop app card appear",
 *          ADR-0055): the title and "Signed in as <email>", then two tiles. "Free session" (gift, a
 *          "Team" badge, "Unlimited · Free", the team account line) with the outlined "Start free",
 *          which goes on to the Connect card. "Paid session" (coins, "No limit · Included") with the
 *          dark "Buy Credits", which only shows a toast: there are no payments in Paramount AI and the
 *          team account is unlimited. "← Back" returns to the sessions.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: lucide-react, ./DesktopFrame.tsx (BuyCreditsButton, NO_CREDITS_NEEDED, useFrameToast)
 * Architecture: ADR-0055
 */
'use client';

import { ArrowLeft, Coins, Gift } from 'lucide-react';
import type { ReactNode } from 'react';
import { BuyCreditsButton, NO_CREDITS_NEEDED, useFrameToast } from './DesktopFrame';

/** Props for LauncherStart. */
export interface LauncherStartProps {
  /** The signed-in account's email. */
  email: string;
  /** "Start free": on to the Connect card. */
  onStartFree: () => void;
  /** "← Back": the sessions card. */
  onBack: () => void;
}

/** An outlined full-width button (reference: 44 px, radius 10, a light border). */
const OUTLINED =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-ui-border bg-ui-bg px-4 text-[15px] font-medium text-ui-heading hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * One tile: an icon, a title, a line, a grey note, an optional badge in the corner, and a button.
 *
 * @param props.icon   The icon.
 * @param props.title  The title.
 * @param props.line   The line under it.
 * @param props.note   The grey note.
 * @param props.badge  The corner badge (the Free tile's "Team").
 * @param props.action The button.
 * @returns The tile.
 * Rendered by: LauncherStart
 */
function Tile({
  icon,
  title,
  line,
  note,
  badge,
  action,
}: {
  /** The icon. */
  icon: ReactNode;
  /** The title. */
  title: string;
  /** The line under it. */
  line: string;
  /** The grey note. */
  note: string;
  /** The corner badge. */
  badge?: string;
  /** The button. */
  action: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="relative flex flex-col items-center gap-1.5 rounded-[14px] border border-ui-border bg-ui-bg px-4 pb-4 pt-6 text-center"
    >
      {badge && (
        <span className="absolute right-0 top-0 rounded-bl-[10px] rounded-tr-[14px] bg-ui-subtle px-3 py-1.5 text-[13px] font-medium text-ui-heading">
          {badge}
        </span>
      )}
      <span className="text-ui-heading">{icon}</span>
      <h2 className="text-[15px] font-medium text-ui-heading">{title}</h2>
      <p className="text-[15px] text-ui-text">{line}</p>
      <p className="mt-1.5 text-[14px] text-ui-muted">{note}</p>
      <div className="mt-3 w-full">{action}</div>
    </section>
  );
}

/**
 * The card.
 *
 * @param props See LauncherStartProps.
 * @returns The card.
 * Rendered by: Launcher.tsx
 */
export function LauncherStart({ email, onStartFree, onBack }: LauncherStartProps) {
  const toast = useFrameToast();
  return (
    <div className="px-4 pb-4 pt-1">
      <div className="flex flex-col gap-4 rounded-[16px] border border-ui-border bg-ui-bg p-4">
        <header className="flex flex-col items-center gap-1 pt-2 text-center">
          <h1 className="text-[18px] font-medium text-ui-heading">Start your session</h1>
          <p className="max-w-full truncate text-[13px] text-ui-muted">Signed in as {email}</p>
        </header>
        <Tile
          icon={<Gift aria-hidden="true" size={20} strokeWidth={1.5} />}
          title="Free session"
          line="Unlimited · Free"
          note="Paramount Intelligence team account."
          badge="Team"
          action={
            <button type="button" className={OUTLINED} onClick={onStartFree}>
              Start free
            </button>
          }
        />
        <Tile
          icon={<Coins aria-hidden="true" size={20} strokeWidth={1.5} />}
          title="Paid session"
          line="No limit · Included"
          note="Your team account already includes everything."
          action={<BuyCreditsButton label="Buy Credits" onPress={() => toast(NO_CREDITS_NEEDED)} />}
        />
        <button type="button" className={OUTLINED} onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
          Back
        </button>
      </div>
    </div>
  );
}
