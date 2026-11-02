/**
 * File: apps/web/src/ui/Dialog.tsx
 * Purpose: A modal dialog built on the browser's own <dialog> element (showModal): it traps
 *          keyboard focus, closes on Escape and dims the page, with no extra library.
 * Used by: src/features/session-setup/ChoosePlatformDialog.tsx, src/features/dashboard/SessionCard.tsx
 *          (delete confirmation), src/features/settings/Settings.tsx (delete-all confirmation),
 *          and more; DialogPanel also by src/features/dev/UiGallery.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css)
 */
'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Props for Dialog. */
export interface DialogProps {
  /** True to show the dialog. */
  open: boolean;
  /** Called when the user closes it (Escape, the close button, or a click outside). */
  onClose: () => void;
  /** Heading at the top. */
  title: string;
  /** The dialog's content. */
  children: ReactNode;
  /** Buttons at the bottom, right-aligned (for example Cancel and Delete). */
  footer?: ReactNode;
  /** Width: 'md' (default, about 28 rem), 'lg' (about 42 rem, tables) or 'xl' (about 56 rem, two panes). */
  size?: 'md' | 'lg' | 'xl';
}

/**
 * A modal dialog. While `open` is true it is shown with showModal(), so the rest of the page
 * cannot be clicked or tabbed into.
 *
 * @param props See DialogProps.
 * @returns The <dialog> element (hidden while closed).
 * Rendered by: ChoosePlatformDialog.tsx, SessionCard.tsx, Settings.tsx
 */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // The element is opened and closed imperatively: React's `open` attribute would show it
  // without the modal behaviour (focus trap, Escape, backdrop).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape fires 'cancel'; let the parent decide by turning it into onClose.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the <dialog> element itself, not on its content.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={[
        // Theme §5 Modal: the modal radius and shadow, over a dim backdrop. The width leaves a
        // margin on a phone, so the rounded corners stay visible.
        'm-auto w-[calc(100%-2rem)] rounded-modal border border-ui-border bg-ui-surface p-0 text-ui-text shadow-modal backdrop:bg-ui-overlay',
        { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size],
      ].join(' ')}
    >
      <DialogPanel titleId={titleId} title={title} onClose={onClose} footer={footer}>
        {children}
      </DialogPanel>
    </dialog>
  );
}

/** Props for DialogPanel. */
export interface DialogPanelProps {
  /** The heading's id (the dialog is labelled by it). */
  titleId: string;
  /** Heading at the top. */
  title: string;
  /** Called by the close button. */
  onClose: () => void;
  /** The content. */
  children: ReactNode;
  /** Buttons at the bottom, right-aligned. */
  footer?: ReactNode;
}

/**
 * The inside of a dialog: title with a close button, content, footer. Separate from Dialog so
 * the UI gallery (/dev/ui) can show the modal's styling without opening a modal.
 *
 * @param props See DialogPanelProps.
 * @returns The panel.
 * Rendered by: Dialog; src/features/dev/UiGallery.tsx
 */
export function DialogPanel({ titleId, title, onClose, children, footer }: DialogPanelProps) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-[18px] font-semibold text-ui-heading">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 rounded-control text-xl leading-none text-ui-muted hover:bg-ui-hover hover:text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          ×
        </button>
      </div>
      <div className="text-[15px] leading-relaxed text-ui-text">{children}</div>
      {footer && <div className="flex justify-end gap-2">{footer}</div>}
    </div>
  );
}
