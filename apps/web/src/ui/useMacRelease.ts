/**
 * File: apps/web/src/ui/useMacRelease.ts
 * Purpose: ADR-0125: a React hook that says whether the Mac app is published (core/download/macRelease.ts), so
 *          the "Get it for Mac" dialog offers the install command only when there is a release, and "Mac
 *          version coming soon" otherwise. It asks only once the dialog is opened (pages that never open it
 *          never ask).
 * Used by: src/features/shell/MacInstall.tsx
 * Depends on: src/core/download/macRelease.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.3 (installation); ADR-0125
 */
'use client';

import { useEffect, useState } from 'react';
import { macReleasePublished, type MacReleaseState } from '@/core/download/macRelease';

/**
 * Whether the Mac app is published.
 *
 * @param active True once the answer is needed (the dialog is open).
 * @returns True or false once the server has answered; null until then (and while not active).
 * Called from: MacInstallSteps in src/features/shell/MacInstall.tsx
 */
export function useMacRelease(active: boolean): MacReleaseState {
  const [published, setPublished] = useState<MacReleaseState>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    void macReleasePublished().then((answer) => {
      if (current) setPublished(answer);
    });
    return () => {
      current = false;
    };
  }, [active]);
  return published;
}
