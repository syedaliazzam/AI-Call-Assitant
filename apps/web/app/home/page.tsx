/**
 * File: apps/web/app/home/page.tsx
 * Purpose: The /home route: the home panel, the desktop app's default window between calls (v1.1.0,
 *          ADR-0041). Signed-in users only. Outside the (app) group on purpose, so it has no sidebar:
 *          the window is small. Opened in a browser, the panel sends it to the dashboard.
 * Used by: Next.js App Router; loaded by apps/desktop/src/home.ts
 * Depends on: src/server/guard.ts (requireUser), src/features/home/HomePanel.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §9.2 (thin routes); ADR-0041
 */
import { HomePanel } from '@/features/home/HomePanel';
import { requireUser } from '@/server/guard';

/**
 * Home panel page.
 *
 * @returns The panel for the signed-in person.
 */
export default async function HomeRoute() {
  // Same sign-in rules as every app page (temporary passwords go to /change-password).
  const { user } = await requireUser();
  return <HomePanel name={user.name} email={user.email} />;
}
