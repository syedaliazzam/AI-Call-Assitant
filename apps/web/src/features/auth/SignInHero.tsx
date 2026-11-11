/**
 * File: apps/web/src/features/auth/SignInHero.tsx
 * Purpose: The middle of the sign-in page's left panel (ADR-0071): a small "Live call assistant" label,
 *          the headline, a still preview of the app during a call (the call bar with Answer,
 *          Screenshot and Chat, and one answer card) and three feature rows. The preview is drawn with
 *          the call bars' own pieces and the answer card's own AnswerBody, so it looks like the app and
 *          follows it when the app changes. Its words are invented; nothing in it can be pressed.
 * Used by: app/login/page.tsx, app/change-password/page.tsx (through src/ui/AuthCard.tsx)
 * Depends on: lucide-react, src/features/answers/AnswerBody.tsx, src/features/live/overlay/parts.tsx,
 *             src/ui/icons.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in); ADR-0071
 *
 * A client module: the call bars' pieces live in one, and their style constants cannot cross into a
 * server component.
 */
'use client';

import { EyeOff, MessageSquareText, NotebookPen } from 'lucide-react';
import type { ReactNode } from 'react';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { ICON_BUTTON, KeyChip, PILL, StatusIcon, pieceClass } from '@/features/live/overlay/parts';
import { CloseIcon, MicIcon, MonitorIcon } from '@/ui/icons';

/** The preview's invented question. */
export const PREVIEW_QUESTION =
  'How would you handle a project that is about to miss its deadline?';

/**
 * The preview's invented answer, in the answer format: the answer line (bold), then two bullets.
 */
export const PREVIEW_ANSWER = [
  'Flag it early, reset the plan, and keep the client’s trust.',
  '- Tell the client the same day, with the reason and a new date.',
  '- Ship the core first, then the rest in a short follow-up.',
].join('\n');

/** The feature rows: an icon, a title and one line. */
const FEATURES: readonly { icon: ReactNode; title: string; line: string }[] = [
  {
    icon: <MessageSquareText aria-hidden="true" size={18} strokeWidth={1.75} />,
    title: 'Answers while you talk',
    line: 'Press a key for a short answer from your own documents.',
  },
  {
    icon: <NotebookPen aria-hidden="true" size={18} strokeWidth={1.75} />,
    title: 'Live transcript & notes',
    line: 'Both sides of the call as it happens, and notes after it.',
  },
  {
    icon: <EyeOff aria-hidden="true" size={18} strokeWidth={1.75} />,
    title: 'Hidden from screen share',
    line: 'The desktop app stays off the screen you share.',
  },
];

/**
 * The still preview: the call bar and an answer card, in the call window's dark style.
 *
 * @returns The preview, one picture for screen readers.
 * Rendered by: SignInHero
 */
export function SignInPreview() {
  return (
    <div
      role="img"
      aria-label="A preview of Paramount AI during a call: the call bar with Answer, Screenshot and Chat, and an answer card."
      // @container: the key-caps give way when the panel is narrow (a 900 px window).
      className="@container flex w-full max-w-[560px] flex-col gap-2"
    >
      <div
        aria-hidden="true"
        className={`${pieceClass(false)} flex h-11 items-center gap-1 px-1.5 shadow-modal`}
      >
        <StatusIcon on label="Screen audio" icon={<MonitorIcon />} />
        <StatusIcon on label="Microphone" icon={<MicIcon />} />
        <span className="w-1 shrink-0" />
        <span className={PILL}>
          Answer <KeyChip hotkey="answer" visibleAt="@min-[420px]:inline-flex" />
        </span>
        <span className={PILL}>
          Screenshot <KeyChip hotkey="screenshot" visibleAt="@min-[520px]:inline-flex" />
        </span>
        <span className={PILL}>
          Chat <KeyChip hotkey="chat" visibleAt="@min-[470px]:inline-flex" />
        </span>
        <span className="flex-1" />
        <span className="px-1.5 text-[13px] font-medium tabular-nums">04:26</span>
        <span className={`${ICON_BUTTON} max-[360px]:hidden`}>
          <CloseIcon />
        </span>
      </div>
      <div aria-hidden="true" className={`${pieceClass(false)} p-1.5 shadow-modal`}>
        <div className="flex h-9 items-center gap-1 px-0.5 pb-1">
          <span className={PILL}>
            <KeyChip hotkey="prev" />
          </span>
          <span className={PILL}>
            <KeyChip hotkey="next" />
          </span>
          <span className="flex-1" />
          <span className={PILL}>
            Clear <KeyChip hotkey="clear" visibleAt="@min-[420px]:inline-flex" />
          </span>
        </div>
        <div className="rounded-control bg-ui-overlay-button px-3 py-2.5">
          <p className="border-l-2 border-ui-accent-fill pl-2.5 text-[15px] font-semibold leading-snug text-ui-heading">
            {PREVIEW_QUESTION}
          </p>
          <div className="mt-2">
            <AnswerBody text={PREVIEW_ANSWER} finished size="overlay" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The panel's middle: label, headline, preview and feature rows.
 *
 * @returns The content.
 * Rendered by: app/login/page.tsx and app/change-password/page.tsx, as AuthCard's hero
 */
export function SignInHero() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-start gap-4">
        <p className="inline-flex items-center gap-2 rounded-full border border-ui-border bg-ui-surface px-3 py-1 text-[13px] font-medium text-ui-text shadow-raised">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-ui-accent-fill" />
          Live call assistant
        </p>
        <h2 className="text-[40px] font-medium leading-[1.1] tracking-[-0.01em] text-ui-heading">
          Answers while you talk.
        </h2>
      </div>
      <SignInPreview />
      <ul aria-label="What Paramount AI does" className="flex flex-col gap-4">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-ui-border bg-ui-accent-tint text-ui-accent-fill">
              {feature.icon}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-medium text-ui-heading">{feature.title}</span>
              <span className="text-[14px] text-ui-muted">{feature.line}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
