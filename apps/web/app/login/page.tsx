/**
 * File: apps/web/app/login/page.tsx
 * Purpose: The /login route. Shows the sign-in form; visitors who are already signed in are
 *          sent on (dashboard, or /change-password if they still have a temporary password).
 * Used by: Next.js App Router; proxy.ts and src/server/guard.ts redirect here
 * Depends on: src/server/auth.ts, src/server/guard.ts, src/features/auth/LoginForm.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in), §8.2
 */
import { redirect } from 'next/navigation';
import { LoginForm } from '@/features/auth/LoginForm';
import { getSession } from '@/server/auth';
import { decideRedirect } from '@/server/guard';
import { AuthCard } from '@/ui/AuthCard';

/**
 * Sign-in page.
 *
 * @returns The sign-in card, or a redirect when already signed in.
 */
export default async function LoginPage() {
  const target = decideRedirect(await getSession(), '/login');
  if (target) redirect(target);

  return (
    <AuthCard title="Sign in to Kite" subtitle="Use the email and password your admin gave you.">
      <LoginForm />
    </AuthCard>
  );
}
