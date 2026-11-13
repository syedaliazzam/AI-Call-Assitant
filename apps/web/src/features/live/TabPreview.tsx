/**
 * File: apps/web/src/features/live/TabPreview.tsx
 * Purpose: The top of the browser call view's left column (live-ui-split): the shared tab's video
 *          rendered live and edge to edge, sized to the tab's own shape so no space is wasted, with
 *          Change tab and Minimize small over its corner. Under the video is the control strip:
 *          Stop (with a mic status dot), Clear (the transcript), the audio meters and the language
 *          picker. Browser only; on the desktop the other side is system audio with no video.
 * Used by: src/features/live/BrowserCallLayout.tsx
 * Depends on: src/core/storage/types.ts (ANSWER_LANGUAGES), src/ui/icons; a MediaStream from
 *             core/audio/capture.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0033
 *
 * The video element is muted: the other side's sound already plays through the meeting; playing it
 * again here would echo. This only shows what is already shared; it sends nothing anywhere.
 */
'use client';

import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ANSWER_LANGUAGES } from '@/core/storage/types';
import { ChevronDownIcon, CloseIcon, GlobeIcon, MicIcon } from '@/ui/icons';

/** A button in the control strip under the video. */
const STRIP_BUTTON =
  'inline-flex h-10 items-center gap-2 rounded-control border border-ui-border bg-ui-surface px-3.5 text-[14px] font-medium text-ui-text hover:bg-ui-hover focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11';

/** A small button over the video's corner: solid, so it reads on any picture (ADR-0040). */
const CORNER_BUTTON =
  'inline-flex h-8 items-center rounded-control border border-ui-border bg-ui-surface px-3 text-[13px] font-medium text-ui-text hover:bg-ui-hover focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11';

/** Width over height until the video reports its own: about what a browser tab measures. */
const DEFAULT_RATIO = 2;

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
  /** The audio meters, shown in the control strip. */
  meters?: ReactNode;
}

/**
 * The shared-tab preview and the control strip under it.
 *
 * @param props See TabPreviewProps.
 * @returns The preview and the strip, as two children of the column.
 * Rendered by: BrowserCallLayout
 */
export function TabPreview(props: TabPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = (props.stream?.getVideoTracks().length ?? 0) > 0;
  const [ratio, setRatio] = useState(DEFAULT_RATIO);

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

  /**
   * Takes the shared tab's real shape, when it first plays and whenever it is resized, so the
   * preview fills the column's width with no bars above and below.
   *
   * @param event The video's loadedmetadata or resize event.
   * @returns Nothing.
   */
  const readRatio = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) setRatio(videoWidth / videoHeight);
  };

  return (
    <>
      {/* max-h: a tall tab still leaves the transcript room; object-contain then shows all of it. */}
      <div
        className="k-dark relative flex max-h-[62%] w-full shrink-0 overflow-hidden bg-black"
        style={{ aspectRatio: ratio }}
      >
        {hasVideo ? (
          // object-contain so a tall or wide tab is never cropped; muted to avoid echo.
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            aria-label="Shared tab preview"
            onLoadedMetadata={readRatio}
            onResize={readRatio}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-ui-muted">
            {props.themLabel
              ? `No preview for ${props.themLabel}. The transcript is below.`
              : 'The shared tab will show here once the call connects.'}
          </div>
        )}
        <div className="absolute left-2 top-2 flex items-center gap-2">
          <button type="button" className={CORNER_BUTTON} onClick={props.onChangeTab}>
            Change tab
          </button>
          <button type="button" className={CORNER_BUTTON} onClick={props.onMinimize}>
            Minimize
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ui-border px-3 py-2.5">
        <button type="button" className={STRIP_BUTTON} onClick={props.onStop}>
          Stop
          <MicIcon />
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${props.micOn ? 'bg-ui-success' : 'bg-ui-danger'}`}
          />
        </button>
        <button type="button" className={STRIP_BUTTON} onClick={props.onClear}>
          <CloseIcon />
          Clear
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {props.meters && <div className="flex flex-col gap-1">{props.meters}</div>}
          <label className="relative inline-flex items-center text-ui-text">
            <span className="sr-only">Answer language</span>
            <span className="pointer-events-none absolute left-3 inline-flex">
              <GlobeIcon />
            </span>
            <select
              aria-label="Answer language"
              value={props.language}
              onChange={(event) => props.onLanguage(event.target.value)}
              className="h-10 appearance-none rounded-control border border-ui-border bg-ui-surface py-0 pl-9 pr-8 text-[14px] font-medium leading-none text-ui-text hover:bg-ui-hover focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11"
            >
              {ANSWER_LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 inline-flex text-ui-muted">
              <ChevronDownIcon />
            </span>
          </label>
        </div>
      </div>
    </>
  );
}
