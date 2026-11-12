/**
 * File: apps/web/src/features/live/overlay/ScriptBar.tsx
 * Purpose: The script bar (v1.0.2, ADR-0035; Ctrl+Alt+S): a slim bar at the top centre with the answer
 *          line and its first bullet, to read while looking at the camera. A microphone and a one-line
 *          input talk or type to the current chat mode; Escape closes the input; clicking the words
 *          goes back to the full overlay. The whole bar drags the window, like bar 1.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/core/answer/format.ts, src/core/live/liveChannel.ts,
 *             src/core/storage/overlayPrefs.ts (the opacity default), src/features/live/ChatBox.tsx
 *             (the choices), src/ui/icons.tsx, ./parts.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0035
 */
'use client';

import { useState, type CSSProperties } from 'react';
import { splitAnswer } from '@/core/answer/format';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import { OVERLAY_OPACITY } from '@/core/storage/overlayPrefs';
import { TARGET_OPTIONS } from '@/features/live/ChatBox';
import { ExpandIcon, MicIcon } from '@/ui/icons';
import { BUTTON, BUTTON_BASE, ICON_BUTTON } from './parts';

/** Props for ScriptBar. */
export interface ScriptBarProps {
  /** What the live page shows. */
  state: CompactState;
  /** True for the see-through panel (the desktop window). */
  glass: boolean;
  /** The panel's background opacity (ADR-0033), when the window can change it. */
  panelAlpha: number | undefined;
  /** Whether the one-line input is open. */
  inputOpen: boolean;
  /** Opens or closes the input (the window grows by one row for it). */
  onInputOpen: (open: boolean) => void;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
}

/**
 * The script bar.
 *
 * @param props See ScriptBarProps.
 * @returns The bar.
 * Rendered by: CompactView.tsx (when state.scriptBar is on)
 */
export function ScriptBar({
  state,
  glass,
  panelAlpha,
  inputOpen,
  onInputOpen,
  onCommand,
}: ScriptBarProps) {
  const [text, setText] = useState('');
  const answer = state.answer;
  const parts = answer ? splitAnswer(answer.text) : null;
  const line = parts?.headline || (answer?.status === 'streaming' ? 'Answering…' : '');
  const first = parts?.bullets[0] ?? '';
  /** Back to the full overlay. */
  const full = () => {
    onCommand({ type: 'script-bar', on: false });
  };

  return (
    <div
      className={`k-overlay ${glass ? 'k-glass' : ''} flex h-screen flex-col overflow-hidden rounded-card border border-ui-border text-ui-text`}
      style={
        glass
          ? ({ '--k-overlay-alpha': panelAlpha ?? OVERLAY_OPACITY.default } as CSSProperties)
          : undefined
      }
    >
      <div
        role="toolbar"
        aria-label="Script bar"
        className="flex h-16 shrink-0 items-center gap-2 px-3 [-webkit-app-region:drag]"
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left [-webkit-app-region:no-drag] focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
          onClick={full}
        >
          <span aria-label="Answer line" className="block truncate text-[17px] font-bold leading-6">
            {line || state.notice || 'Press Answer when they ask something.'}
          </span>
          {first && (
            <span className="block truncate text-[14px] leading-5 text-ui-muted">{first}</span>
          )}
        </button>
        {state.dictationSupported && (
          <button
            type="button"
            className={`${ICON_BUTTON} ${state.dictating ? 'text-ui-danger' : ''}`}
            aria-label={state.dictating ? 'Stop listening' : 'Speak a question'}
            aria-pressed={state.dictating ?? false}
            onClick={() => onCommand({ type: 'dictate', on: !state.dictating })}
          >
            <MicIcon />
          </button>
        )}
        <button
          type="button"
          className={BUTTON}
          aria-pressed={inputOpen}
          onClick={() => onInputOpen(!inputOpen)}
        >
          Type
        </button>
        <button
          type="button"
          className={`${BUTTON_BASE} bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover`}
          onClick={() => onCommand({ type: 'answer' })}
          disabled={state.ended || state.answering}
        >
          Answer
        </button>
        <button type="button" className={ICON_BUTTON} aria-label="Full overlay" onClick={full}>
          <ExpandIcon />
        </button>
      </div>
      {inputOpen && (
        <form
          className="flex shrink-0 gap-1 border-t border-ui-border px-2 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const question = text.trim();
            if (!question) return;
            onCommand({ type: 'chat', question });
            setText('');
            onInputOpen(false);
          }}
        >
          <input
            autoFocus
            aria-label="Type a question"
            className="h-9 min-w-0 flex-1 border border-ui-border bg-ui-input px-2 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)]"
            placeholder={`Type to Paramount AI (${TARGET_OPTIONS.find((option) => option.value === (state.chatTarget ?? 'auto'))?.label ?? 'Auto'}), then Enter`}
            value={text}
            maxLength={2_000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setText('');
                onInputOpen(false);
              }
            }}
          />
        </form>
      )}
    </div>
  );
}
