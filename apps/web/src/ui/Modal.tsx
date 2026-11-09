/**
 * File: apps/web/src/ui/Modal.tsx
 * Purpose: The modal window (spec §1: radius 20, title 24/500), built on the browser's own <dialog>
 *          (showModal): it traps keyboard focus, closes on Escape and dims the page, with no extra
 *          library. One pane, or two: a grey `rail` on the left (Create session) or a grey `aside` on
 *          the right (Answer preferences). On a phone it can fill the screen.
 * Used by: src/ui/Dialog.tsx, src/features/session-setup/*
 * Depends on: React, lucide-react
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S4, S6, S7, S8);
 *               docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';

/** Props for Modal. */
export interface ModalProps {
  /** True to show it. */
  open: boolean;
  /** Called when the user closes it (Escape, ✕, or a click outside). */
  onClose: () => void;
  /** The heading. In a modal with a rail it sits at the top of the rail. */
  title: string;
  /** The line under the heading. */
  subtitle?: string;
  /** The content. */
  children: ReactNode;
  /** Buttons at the bottom of the main pane, right-aligned. */
  footer?: ReactNode;
  /** Its width in px on a computer (default 448). */
  width?: number;
  /** A fixed height in px on a computer; without it, the content decides. */
  height?: number;
  /** A left pane under the heading, in the sidebar colour (Create session's stepper). */
  rail?: ReactNode;
  /** The left pane's width in px (default 220). */
  railWidth?: number;
  /** A right pane in the inner-panel colour (the preferences' live preview). */
  aside?: ReactNode;
  /** True to fill the screen on a phone (390 px) instead of floating. */
  fullScreenOnPhone?: boolean;
  /** True to centre the heading (Choose platform). */
  centerTitle?: boolean;
  /** False to stop a click outside from closing it, when typed work could be lost. Default true. */
  closeOnBackdrop?: boolean;
}

/**
 * A modal window. While `open` is true it is shown with showModal(), so the rest of the page cannot be
 * clicked or tabbed into.
 *
 * @param props See ModalProps.
 * @returns The <dialog> element (hidden while closed).
 * Rendered by: Dialog.tsx, SessionWizard.tsx, AnswerPreferencesDialog.tsx
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 448,
  height,
  rail,
  railWidth = 220,
  aside,
  fullScreenOnPhone = false,
  centerTitle = false,
  closeOnBackdrop = true,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();

  // The element is opened and closed imperatively: React's `open` attribute would show it
  // without the modal behaviour (focus trap, Escape, backdrop).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const sizes = {
    '--modal-w': `${width}px`,
    // Not 'auto': a dialog is pinned top and bottom, so auto would fill the window.
    '--modal-h': height ? `${height}px` : 'fit-content',
    '--modal-rail': `${railWidth}px`,
  } as CSSProperties;

  const heading = (
    <div className={`flex flex-col gap-1 ${centerTitle ? 'text-center' : ''}`}>
      <h2 id={titleId} className="text-modal-title text-ui-heading">
        {title}
      </h2>
      {subtitle && (
        <p id={subtitleId} className="text-modal-subtitle text-ui-muted">
          {subtitle}
        </p>
      )}
    </div>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      style={sizes}
      // Escape fires 'cancel'; let the parent decide by turning it into onClose.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the <dialog> element itself, not on its content.
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      className={[
        // The width leaves a margin on a phone, so the rounded corners stay visible.
        'k-anim-modal m-auto h-(--modal-h) max-h-[calc(100dvh-2rem)] w-(--modal-w) max-w-[calc(100vw-2rem)] overflow-hidden rounded-modal border border-ui-border bg-ui-bg p-0 text-ui-text shadow-modal backdrop:bg-ui-overlay',
        fullScreenOnPhone
          ? 'max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:border-0'
          : '',
      ].join(' ')}
    >
      <div
        className={[
          'relative grid h-full max-h-[inherit]',
          rail ? 'grid-cols-[var(--modal-rail)_minmax(0,1fr)] max-sm:grid-cols-1' : '',
          aside ? 'grid-cols-2 max-md:grid-cols-1' : '',
        ].join(' ')}
      >
        {rail && (
          <div className="flex min-h-0 flex-col gap-6 border-r border-ui-border bg-ui-sidebar p-6 max-sm:border-r-0 max-sm:border-b max-sm:p-4 max-sm:pr-12">
            {heading}
            {rail}
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 max-sm:p-4">
            {!rail && heading}
            <div className="text-input leading-relaxed text-ui-text">{children}</div>
          </div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-3 px-6 pb-6 max-sm:px-4 max-sm:pb-4">
              {footer}
            </div>
          )}
        </div>
        {aside && (
          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto bg-ui-panel p-6 max-sm:p-4">
            {aside}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-control text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:size-11"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
    </dialog>
  );
}
