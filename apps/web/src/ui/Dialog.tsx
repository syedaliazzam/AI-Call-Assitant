/**
 * File: apps/web/src/ui/Dialog.tsx
 * Purpose: A plain modal dialog: a title, content and buttons, in the three widths the app's simple
 *          dialogs use. Built on Modal. DialogPanel is its inside without the modal, for the UI gallery.
 * Used by: src/features/dashboard/SessionMenu.tsx (delete confirmation), src/features/settings/*
 *          (delete-all confirmation), and more; DialogPanel also by src/features/dev/UiGallery.tsx
 * Depends on: React, lucide-react, ./Modal.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §1; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';

/** The widths of a dialog, in px. */
const WIDTHS = { md: 448, lg: 672, xl: 896 } as const;

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
  /** Width: 'md' (default, 448 px), 'lg' (672 px, tables) or 'xl' (896 px, two panes). */
  size?: 'md' | 'lg' | 'xl';
}

/**
 * A modal dialog. While `open` is true the rest of the page cannot be clicked or tabbed into.
 *
 * @param props See DialogProps.
 * @returns The dialog (hidden while closed).
 * Rendered by: SessionMenu.tsx, Settings.tsx and other simple dialogs
 */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: DialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer} width={WIDTHS[size]}>
      {children}
    </Modal>
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
 * The look of a dialog without opening one, so the UI gallery (/dev/ui) can show it in place.
 *
 * @param props See DialogPanelProps.
 * @returns The panel.
 * Rendered by: src/features/dev/UiGallery.tsx
 */
export function DialogPanel({ titleId, title, onClose, children, footer }: DialogPanelProps) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-modal-title text-ui-heading">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-control text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:size-11"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="text-input leading-relaxed text-ui-text">{children}</div>
      {footer && <div className="flex justify-end gap-3">{footer}</div>}
    </div>
  );
}
