/**
 * File: apps/web/app/(app)/profile/page.tsx
 * Purpose: The /profile route: the signed-in person's name, email and a link to change the password.
 *          Kept thin: it reads the user and renders the Profile feature.
 * Used by: Next.js App Router (the user menu's Profile)
 * Depends on: src/server/guard.ts, src/features/profile/ProfileDetails.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2)
 */
import { ProfileDetails } from '@/features/profile/ProfileDetails';
import { requireUser } from '@/server/guard';

/**
 * Profile page.
 *
 * @returns The Profile feature component.
 */
export default async function ProfilePage() {
  const { user } = await requireUser();
  return <ProfileDetails name={user.name} email={user.email} />;
}
