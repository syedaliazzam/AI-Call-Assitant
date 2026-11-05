/**
 * File: apps/web/src/features/live/overlay/AnswerPreferencesSheet.tsx
 * Purpose: Answer preferences during a call (spec S16): the Answer preferences window (S6) as a compact
 *          sheet that fits the overlay: Format with STAR, Length, Tone, a hand-written sample of the
 *          result, Set as default, and Back to the menu. A change applies to the next answer at once,
 *          and stays with the session.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: lucide-react, src/core/live/liveChannel.ts, src/core/storage (settings, types),
 *             src/features/preferences/previewSamples.ts, src/features/session-setup/labels.ts,
 *             src/ui/PanelMenu.tsx, ./parts.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S6, S16), §6 (STAR)
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import { forwardRef, useState } from 'react';
import type { CompactCommand } from '@/core/live/liveChannel';
import { getSessionDefaults, saveSessionDefaults } from '@/core/storage/settings';
import type { AnswerStyle } from '@/core/storage/types';
import { renderSample } from '@/features/preferences/previewSamples';
import { FORMAT_OPTIONS, LENGTH_OPTIONS, TONE_OPTIONS } from '@/features/session-setup/labels';
import { MenuBlock, MenuList, MenuSwitch } from '@/ui/PanelMenu';
import { BUTTON } from './parts';

/** Props for AnswerPreferencesSheet. */
export interface AnswerPreferencesSheetProps {
  /** The session's current style. */
  style: AnswerStyle;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Goes back to the menu. */
  onBack: () => void;
}

/**
 * The sheet.
 *
 * @param props See AnswerPreferencesSheetProps.
 * @param ref   Its element, so the window can grow to fit it.
 * @returns The sheet.
 * Rendered by: CompactView.tsx
 */
export const AnswerPreferencesSheet = forwardRef<HTMLDivElement, AnswerPreferencesSheetProps>(
  function AnswerPreferencesSheet({ style, onCommand, onBack }, ref) {
    const [savedDefault, setSavedDefault] = useState<AnswerStyle | null>(null);
    const sample = renderSample('behavioural', style);

    /**
     * Applies a change.
     *
     * @param next The new style.
     * @returns Nothing.
     */
    const change = (next: AnswerStyle) => onCommand({ type: 'style', style: next });

    /** Saves the current choices as the default for new sessions (Settings). */
    const setAsDefault = async () => {
      const defaults = await getSessionDefaults();
      await saveSessionDefaults({ ...defaults, style });
      setSavedDefault(style);
    };

    return (
      <div
        ref={ref}
        role="group"
        aria-label="Answer preferences"
        className="k-overlay-menu absolute right-1.5 top-[calc(100%+6px)] z-30 flex max-h-[calc(100vh-3.75rem)] w-80 flex-col gap-1.5 overflow-y-auto rounded-menu border border-ui-border p-1.5 text-ui-text shadow-modal [-webkit-app-region:no-drag]"
      >
        <div className="flex items-center gap-1 px-1 py-0.5">
          <button type="button" className={BUTTON} onClick={onBack}>
            <ArrowLeft aria-hidden="true" size={14} />
            Back
          </button>
          <span className="text-[13px] font-medium">Answer preferences</span>
        </div>
        <MenuBlock>
          <MenuList
            label="Format"
            value={style.format}
            options={FORMAT_OPTIONS}
            onChange={(format) => change({ ...style, format })}
          />
          <MenuSwitch
            label="STAR structure"
            checked={Boolean(style.star)}
            info="For behavioural answers: Situation, Task, Action and Result, each from what your CV says."
            onChange={(star) => change({ ...style, star })}
          />
          <MenuList
            label="Length"
            value={style.length}
            options={LENGTH_OPTIONS}
            onChange={(length) => change({ ...style, length })}
          />
          <MenuList
            label="Tone"
            value={style.tone}
            options={TONE_OPTIONS}
            onChange={(tone) => change({ ...style, tone })}
          />
        </MenuBlock>
        <section
          aria-label="Sample answer"
          className="flex flex-col gap-1 rounded-menu border border-ui-border px-3 py-2 text-[13px] leading-snug"
        >
          {sample.text && <p className="font-medium">{sample.text}</p>}
          {sample.bullets.length > 0 && (
            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-ui-muted">
              {sample.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex items-center gap-2 px-1 pb-0.5">
          <button type="button" className={BUTTON} onClick={() => void setAsDefault()}>
            Set as default
          </button>
          {JSON.stringify(savedDefault) === JSON.stringify(style) && (
            <span role="status" className="text-[12px] text-ui-success">
              New sessions will start with these.
            </span>
          )}
        </div>
      </div>
    );
  },
);
