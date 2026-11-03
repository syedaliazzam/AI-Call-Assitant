/**
 * File: apps/web/src/features/live/TabPreview.tsx
 * Purpose: The browser split call view's left preview (live-ui-split): the shared tab's video
 *          rendered live, with a translucent control strip over its top — Stop (with a mic status
 *          dot), Clear (the transcript), a language picker, Minimize (opens the overlay), and
 *          Change tab (re-picks the shared tab without ending the call). Browser only; on the
 *          desktop the other side is system audio with no video, so a placeholder is shown.
 * Used by: src/features/live/BrowserCallLayout.tsx
 * Depends on: @kite/web ANSWER_LANGUAGES, src/ui/icons; a MediaStream from core/audio/capture.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0033 (the
 *               translucent panel uses the overlay tokens, so the preview shows through)
 *
 * The video element is muted: the other side's sound already plays through the meeting; playing it
 * again here would echo. Audio never leaves the device — this only shows what is already shared.
 */
'use client';

import { useEffect, useRef } from 'react';
import { ANSWER_LANGUAGES } from '@/core/storage/types';

/** A control-strip button: subtle on the translucent strip, label hidden when very narrow. */
const STRIP_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-full bg-ui-overlay-button px-3 text-[13px] font-medium text-ui-text hover:bg-ui-overlay-button-hover focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11';

/** Props for TabPreview. */
export interface TabPreviewProps {
  /** The shared other-side stream; its video track is rendered. Null before the call connects. */
  stream: MediaStream | null;
  /** Where "Them" comes from, for the placeholder line when there is no video (desktop). */
  themLabel: string | null;
  /** True while the microphone is live (the Stop button's status dot). */
  micOn: boolean;
  /** The answer language code (ANSWER_LANGUAGES), shown in the picker. */
  language: string;
  /** Changes the answer language for the rest of the call. */
  onLanguage: (code: string) => void;
  /** Ends the call. */
  onStop: () => void;
  /** Clears the live transcript (not the answers). */
  onClear: () => void;
  /** Opens the overlay (picture-in-picture). */
  onMinimize: () => void;
  /** Re-picks the shared tab without ending the call. */
  onChangeTab: () => void;
}

/**
 * The shared-tab preview with its control strip.
 *
 * @param props See TabPreviewProps.
 * @returns The preview.
 * Rendered by: BrowserCallLayout
 */
export function TabPreview(props: TabPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = (props.stream?.getVideoTracks().length ?? 0) > 0;

  // Attach the stream to the <video>; a plain src cannot carry a MediaStream.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = hasVideo ? props.stream : null;
    if (hasVideo) video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [props.stream, hasVideo]);

  return (
    <div className="k-dark relative flex min-h-0 flex-1 overflow-hidden rounded-card border border-ui-border bg-ui-bg">
      {hasVideo ? (
        // object-contain so a tall or wide tab is never cropped; muted to avoid echo.
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          aria-label="Shared tab preview"
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-ui-muted">
          {props.themLabel
            ? `No preview for ${props.themLabel}. The transcript is below.`
            : 'The shared tab will show here once the call connects.'}
        </div>
      )}

      {/* The control strip over the top, in the overlay's tokens but solid (v1.0.4, ADR-0040): only
          the overlay itself is ever see-through. */}
      <div className="k-overlay absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 border-b border-ui-border p-2">
        <button type="button" className={STRIP_BUTTON} onClick={props.onStop}>
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${props.micOn ? 'bg-ui-success' : 'bg-ui-danger'}`}
          />
          Stop
        </button>
        <button type="button" className={STRIP_BUTTON} onClick={props.onClear}>
          Clear
        </button>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-ui-muted">
          <span className="sr-only">Answer language</span>
          <select
            aria-label="Answer language"
            value={props.language}
            onChange={(event) => props.onLanguage(event.target.value)}
            className="h-8 rounded-full bg-ui-overlay-button px-2 text-[13px] text-ui-text focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11"
          >
            {ANSWER_LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={STRIP_BUTTON} onClick={props.onChangeTab}>
            Change tab
          </button>
          <button type="button" className={STRIP_BUTTON} onClick={props.onMinimize}>
            Minimize
          </button>
        </div>
      </div>
    </div>
  );
}
