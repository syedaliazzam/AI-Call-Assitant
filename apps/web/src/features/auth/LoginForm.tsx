/**
 * File: apps/web/src/features/auth/LoginForm.tsx
 * Purpose: Email + password sign-in form. No sign-up link: accounts are created by an admin.
 * Used by: app/login/page.tsx
 * Depends on: src/core/auth/authClient.ts, src/core/auth/messages.ts, src/ui/Button.tsx, src/ui/Input.tsx,
 *             src/platform (hasHomePanel)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in), §8.2
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { signIn } from '@/core/auth/authClient';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { messageFor } from '@/core/auth/messages';
import { getPlatform } from '@/platform';

/**
 * The sign-in form. On success it opens the dashboard; the server then sends users who still
 * have a temporary password to /change-password.
 *
 * @returns The form element.
 * Rendered by: app/login/page.tsx
 */
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Sends the email and password to Better Auth and reacts to the result.
   *
   * @param event The form's submit event (the browser's own page reload is prevented).
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    if (result.error) {
      setError(messageFor(result.error.code));
      setPending(false);
      return;
    }
    // refresh() makes the server components re-read the new session cookie. In a desktop app with the
    // home panel (where sign-in happens) straight to /home: its window keeps to its own pages, and with
    // account sync the dashboard ("/") belongs to the browser (ADR-0055).
    router.replace(getPlatform().hasHomePanel() ? '/home' : '/');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Input label="Email" name="email" type="email" autoComplete="email" required autoFocus />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {error && (
        <p
          role="alert"
          className="rounded-control bg-ui-danger-bg px-3 py-2 text-[13px] text-ui-danger"
        >
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
