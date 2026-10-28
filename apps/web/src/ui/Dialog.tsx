/**
 * File: apps/web/src/ui/Dialog.tsx
 * Purpose: A modal dialog built on the browser's own <dialog> element (showModal): it traps
 *          keyboard focus, closes on Escape and dims the page, with no extra library.
 * Used by: src/features/session-setup/ChoosePlatformDialog.tsx, src/features/dashboard/SessionCard.tsx
 *          (delete confirmation), src/features/settings/Settings.tsx (delete-all confirmation)
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
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
  /** Width: 'md' (default, about 28 rem) or 'lg' (about 42 rem, for tables). */
  size?: 'md' | 'lg';
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
        'm-auto w-full rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40',
        size === 'lg' ? 'max-w-2xl' : 'max-w-md',
      ].join(' ')}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        <div className="text-sm text-slate-700">{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}
