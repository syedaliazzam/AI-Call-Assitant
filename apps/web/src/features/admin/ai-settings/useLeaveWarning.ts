/**
 * File: apps/web/src/features/admin/ai-settings/useLeaveWarning.ts
 * Purpose: Warns before leaving Admin → AI settings with unsaved changes (ADR-0089): the browser's own
 *          "Leave site?" prompt when the tab is closed or reloaded, and a confirm before following a link
 *          inside the app (Next.js links change the page without unloading it).
 * Used by: src/features/admin/ai-settings/AiSettingsPage.tsx
 * Depends on: React
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 */
'use client';

import { useEffect } from 'react';

/** The question asked before following a link with unsaved changes. */
export const LEAVE_QUESTION = 'You have unsaved changes to the AI settings. Leave without saving?';

/**
 * The browser's own confirm box (a stable function, so the effect is not set up again on every render).
 *
 * @param question The question.
 * @returns True when the admin agrees.
 */
const windowConfirm = (question: string): boolean => window.confirm(question);

/**
 * Turns the warnings on while `dirty` is true.
 *
 * @param dirty   True while some prompt has unsaved changes.
 * @param confirm Asks the question (tests pass one); window.confirm by default.
 * Called from: AiSettingsPage.tsx
 */
export function useLeaveWarning(
  dirty: boolean,
  confirm: (question: string) => boolean = windowConfirm,
): void {
  useEffect(() => {
    if (!dirty) return;
    /**
     * Asks the browser to show its "Leave site?" prompt.
     *
     * @param event The beforeunload event.
     */
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a value here to show the prompt.
      event.returnValue = '';
    };
    /**
     * Stops a click on a link to another page unless the admin agrees to leave.
     *
     * @param event The click (capture phase, before Next.js handles it).
     */
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname)
        return;
      if (!confirm(LEAVE_QUESTION)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm]);
}
