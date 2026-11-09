/**
 * File: apps/web/tests/lib/motion.ts
 * Purpose: Lets a test wait for the v1.3.1 entrance animations (ADR-0058: modals and desktop cards
 *          scale in from 98 %, menus slide 4 px) to finish before it measures sizes or takes a
 *          picture: a box measured mid-animation is up to 2 % small. Endless animations (the pulsing
 *          Live dot, a listening microphone) are not waited for.
 * Used by: tests/ui/shots.ts (check), tests/integration/setup.spec.ts, handoff.spec.ts, ui-kit.spec.ts,
 *          shell.spec.ts
 * Depends on: @playwright/test (Page type)
 * Architecture: docs/decisions/ADR-0058-green-accent-and-motion.md
 */
import type { Page } from '@playwright/test';

/**
 * Waits until every animation on the page that has an end has finished.
 *
 * @param page The page.
 * @returns Resolves once they have (at once when none run).
 * Called from: check() in tests/ui/shots.ts; setup.spec.ts
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}
