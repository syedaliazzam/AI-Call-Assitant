/**
 * File: apps/web/src/ui/Toast.tsx
 * Purpose: A short message at the bottom of the page after an action (spec §1 motion: toasts rise
 *          200 ms and hide after 3 s, the --k-toast-ms token; success toasts are green, ADR-0058).
 *          useToast() holds the current message; <Toast> draws it. Screen readers hear it through
 *          role="status" (or role="alert" for a failure).
 * Used by: src/features/admin/UsersPage.tsx
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1 (motion, accent)
 * Theme: tokens from src/ui/tokens/theme.css (k-anim-toast)
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** A toast's look: green for something that worked, red for a failure, dark for a note. */
export type ToastTone = 'success' | 'danger' | 'neutral';

/** The colours per tone. */
const TONES: Record<ToastTone, string> = {
  success: 'bg-ui-accent-fill text-ui-on-accent',
  danger: 'bg-ui-end text-ui-on-end',
  neutral: 'bg-ui-primary text-ui-on-primary',
};

/** The message a toast shows. */
export interface ToastMessage {
  /** Changes with every message, so the same words shown twice replay the rise. */
  id: number;
  /** The words. */
  text: string;
  /** Its look. */
  tone: ToastTone;
}

/**
 * How long a toast stays, in ms: the --k-toast-ms token (3 s), or 3000 when it cannot be read (unit
 * tests have no stylesheet). A failure stays twice as long, so there is time to read it.
 *
 * @returns Milliseconds.
 * Called from: useToast()
 */
function toastMs(): number {
  const raw =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue('--k-toast-ms');
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 3_000;
}

/**
 * Holds the current toast and hides it after its time.
 *
 * @returns The message (or null) and show(text, tone).
 * Called from: UsersPage.tsx
 */
export function useToast(): {
  current: ToastMessage | null;
  show: (text: string, tone?: ToastTone) => void;
} {
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const next = useRef(0);

  useEffect(() => {
    if (!current) return;
    const ms = toastMs() * (current.tone === 'danger' ? 2 : 1);
    const timer = window.setTimeout(() => setCurrent(null), ms);
    return () => window.clearTimeout(timer);
  }, [current]);

  const show = useCallback((text: string, tone: ToastTone = 'success') => {
    next.current += 1;
    setCurrent({ id: next.current, text, tone });
  }, []);

  return { current, show };
}

/** Props for Toast. */
export interface ToastProps {
  /** The message, or null for none. */
  message: ToastMessage | null;
}

/**
 * The toast, fixed at the bottom centre of the window.
 *
 * @param props See ToastProps.
 * @returns The live region (always present, so screen readers hear each new message).
 * Rendered by: UsersPage.tsx
 */
export function Toast({ message }: ToastProps) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      {message && (
        // key: a new message replays the rise (200 ms, k-anim-toast).
        <p
          key={message.id}
          role={message.tone === 'danger' ? 'alert' : 'status'}
          className={`k-anim-toast max-w-[min(32rem,100%)] rounded-control px-4 py-2.5 text-center text-[14px] font-medium shadow-modal ${TONES[message.tone]}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
