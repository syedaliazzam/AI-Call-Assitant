/**
 * File: apps/web/src/features/live/CompactView.tsx
 * Purpose: The compact live view (architecture §5): the latest transcript line, the latest
 *          answer (headline, then the bullets, scrollable), Answer, Screenshot and Clear, a box
 *          for a typed question, and the screen-share protection state with its switch
 *          ("Hidden from screen share"). Presentational: CompactLive.tsx gives it the state.
 * Used by: src/features/live/CompactLive.tsx (desktop compact window; browser picture-in-picture
 *          from Stage 4)
 * Depends on: src/core/live/liveChannel.ts (types), src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §4 (protection);
 *               day-05-overlay-screenshots-notes.md Stage 3
 *
 * The top strip is the window's drag handle (the desktop window has no frame). Nothing here
 * calls focus(): updates never take the keyboard from the meeting; clicking into the box does.
 */
'use client';

import type { ShareProtectionState } from '@kite/shared';
import { useState, type KeyboardEvent } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import { Button } from '@/ui/Button';

/** Props for CompactView. */
export interface CompactViewProps {
  /** What to show (null until the live page answers). */
  state: CompactState | null;
  /** Protection of this window (null where it does not apply, for example a browser). */
  protection: ShareProtectionState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Turns protection on or off (desktop). */
  onProtection?: (on: boolean) => void;
}

/** Small mono uppercase label style (the "eyebrow" style). */
const EYEBROW = 'font-mono text-[10px] font-medium uppercase tracking-[0.08em]';

/**
 * The protection label: what the other side of a screen share can see.
 *
 * @param props.protection The state.
 * @param props.onToggle   Turns it on or off.
 * @returns The label and switch, or nothing where protection does not apply.
 */
function ProtectionLabel({
  protection,
  onToggle,
}: {
  /** The state. */
  protection: ShareProtectionState | null;
  /** Turns it on or off. */
  onToggle?: (on: boolean) => void;
}) {
  if (!protection) return null;
  if (!protection.supported) {
    return <span className={`${EYEBROW} text-ui-muted`}>Visible in screen share</span>;
  }
  return (
    <label
      className={`${EYEBROW} flex items-center gap-1 pointer-coarse:min-h-11 [-webkit-app-region:no-drag] ${protection.on ? 'text-ui-success' : 'text-ui-warning'}`}
    >
      <input
        type="checkbox"
        className="h-3 w-3"
        checked={protection.on}
        onChange={(event) => onToggle?.(event.target.checked)}
        aria-label="Hide this window from screen share"
      />
      {protection.on ? 'Hidden from screen share' : 'Visible in screen share'}
    </label>
  );
}

/**
 * The compact live view.
 *
 * @param props See CompactViewProps.
 * @returns The view.
 * Rendered by: CompactLive.tsx
 */
export function CompactView({ state, protection, onCommand, onProtection }: CompactViewProps) {
  const [question, setQuestion] = useState('');
  // The answer's details (bullets) show on expand: the headline comes first.
  const [expanded, setExpanded] = useState(false);

  /**
   * Enter sends the typed question; Escape clears it.
   *
   * @param event The key press in the box.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && question.trim()) {
      event.preventDefault();
      onCommand({ type: 'chat', question: question.trim() });
      setQuestion('');
    } else if (event.key === 'Escape') {
      setQuestion('');
    }
  };

  const answer = state?.answer ?? null;
  return (
    // Theme §6: the same dark tokens as the live view, compact sizes, the headline first and
    // the details on expand. The protection label stays visible in the header.
    <div className="k-dark flex h-screen flex-col bg-ui-bg text-[13px] text-ui-text">
      <header className="flex items-center justify-between gap-2 border-b border-ui-border bg-ui-band px-3 py-1.5 [-webkit-app-region:drag]">
        <span className={`${EYEBROW} text-ui-muted`}>Kite · live</span>
        <ProtectionLabel protection={protection} onToggle={onProtection} />
      </header>

      {state?.ended ? (
        <p className="p-3 text-ui-muted">The call has ended.</p>
      ) : (
        <>
          <section
            aria-label="Latest line"
            className="border-b border-ui-border px-3 py-2 text-[12px] text-ui-text"
          >
            {state?.line ? (
              <p className="line-clamp-2">
                <span
                  className={`${EYEBROW} mr-1 ${state.line.speaker === 'you' ? 'text-ui-you' : 'text-ui-them'}`}
                >
                  {state.line.speaker === 'you' ? 'You' : 'Them'}
                </span>{' '}
                {state.line.text}
              </p>
            ) : (
              <p className="text-ui-muted">
                {state ? 'Nothing said yet.' : 'Connecting to the call…'}
              </p>
            )}
          </section>

          <section
            aria-label="Latest answer"
            className="min-h-0 flex-1 overflow-y-auto border-l-[3px] border-ui-accent px-3 py-2"
          >
            {answer ? (
              <>
                <h2
                  aria-label="Compact headline"
                  className="text-[14px] font-bold leading-snug text-ui-heading"
                >
                  {answer.headline || '…'}
                </h2>
                {answer.bullets.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpanded((open) => !open)}
                      className={`${EYEBROW} mt-1 text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11`}
                    >
                      {expanded ? 'Hide details' : `Details (${answer.bullets.length})`}
                    </button>
                    {expanded && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ui-text">
                        {answer.bullets.map((bullet, i) => (
                          <li key={i}>{bullet}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {answer.status === 'streaming' && (
                  <p className={`${EYEBROW} mt-1 text-ui-muted`}>Answering…</p>
                )}
                {answer.status === 'error' &&
                  (answer.unavailable ? (
                    // Claude is down for everyone: the plain message, and that recording goes on.
                    <p
                      role="alert"
                      className="mt-1 border-l-[3px] border-ui-warning bg-ui-warning-bg px-2 py-1 text-[12px] text-ui-text"
                    >
                      {answer.error}
                    </p>
                  ) : (
                    <p role="alert" className="mt-1 text-[12px] text-ui-danger">
                      {answer.error ?? 'The answer failed.'}
                    </p>
                  ))}
              </>
            ) : (
              <p className="text-ui-muted">
                {state?.notice ?? 'Press Answer when they ask something.'}
              </p>
            )}
          </section>

          <footer className="flex flex-col gap-1.5 border-t border-ui-border bg-ui-band p-2">
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => onCommand({ type: 'answer' })} disabled={!state}>
                Answer
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onCommand({ type: 'screenshot' })}
                disabled={!state || state.capturing}
              >
                {state?.capturing ? 'Screenshot…' : 'Screenshot'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onCommand({ type: 'clear' })}
                disabled={!state}
              >
                Clear
              </Button>
            </div>
            <input
              aria-label="Type a question"
              className="h-8 border border-ui-border bg-ui-input px-2 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 md:text-[12px]"
              placeholder="Type a question, then Enter"
              value={question}
              maxLength={2_000}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={!state}
            />
          </footer>
        </>
      )}
    </div>
  );
}
