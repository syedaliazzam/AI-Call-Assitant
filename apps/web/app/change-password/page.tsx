/**
 * File: apps/web/app/change-password/page.tsx
 * Purpose: The /change-password route. Forced on first sign-in and after an admin resets the
 *          password; signed-in users may also open it to change their password voluntarily.
 * Used by: Next.js App Router; src/server/guard.ts redirects here
 * Depends on: src/server/auth.ts, src/server/guard.ts, src/features/auth/*, ./actions.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Change password), §8.2
 */
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm';
import { SignInHero } from '@/features/auth/SignInHero';
import { SignOutButton } from '@/features/auth/SignOutButton';
import { getSession } from '@/server/auth';
import { decideRedirect } from '@/server/guard';
import { AuthCard } from '@/ui/AuthCard';
import { changePasswordAction } from './actions';

/**
 * Change-password page.
 *
 * @returns The change-password card, or a redirect to /login when signed out.
 */
export default async function ChangePasswordPage() {
  const session = await getSession();
  const target = decideRedirect(session, '/change-password');
  if (target) redirect(target);

  const forced = session?.user.mustChangePassword === true;
  return (
    <AuthCard
      title={forced ? 'Choose a new password' : 'Change password'}
      subtitle={
        forced
          ? 'You are using a temporary password. Choose your own to continue.'
          : 'Enter your current password and a new one.'
      }
      footer={<SignOutButton />}
      // ADR-0071: the same left panel as sign-in.
      hero={<SignInHero />}
    >
      <ChangePasswordForm action={changePasswordAction} />
    </AuthCard>
  );
}
