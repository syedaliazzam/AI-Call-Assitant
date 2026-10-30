/**
 * File: apps/web/app/(app)/dev/ui/page.tsx
 * Purpose: The /dev/ui route (admins only, UI theme stage U1): every shared UI component in the
 *          Kite theme, on a light and a dark surface.
 * Used by: Next.js App Router; linked from /dev; screenshotted by tests/ui/dev-ui.spec.ts
 * Depends on: src/features/dev/UiGallery.tsx
 * Architecture: docs/design/kite-ui-theme.md §9 (stage U1)
 */
import { UiGallery } from '@/features/dev/UiGallery';

/**
 * UI gallery page.
 *
 * @returns The gallery.
 */
export default function UiGalleryPage() {
  return <UiGallery />;
}
