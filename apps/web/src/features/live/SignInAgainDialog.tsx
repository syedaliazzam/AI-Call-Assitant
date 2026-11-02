/**
 * File: apps/web/src/features/live/SignInAgainDialog.tsx
 * Purpose: Signs the user in again during a live call, in a dialog over the call (Day 6 Stage
 *          4e), after an answer failed because the sign-in expired. The page is never left, so
 *          the call, its transcript and its answers stay as they are. (On the desktop a new
 *          window would open the system browser, whose sign-in does not reach the Kite window.)
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/auth/authClient.ts (signIn, loaded on submit), src/core/auth/messages.ts,
 *             src/ui/Dialog.tsx, src/ui/Input.tsx, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts); day-06 Stage 4
 *
 * The password is sent to Better Auth only; it is never logged or kept.
 */
'use client';

import { useState, type FormEvent } from 'react';
import { messageFor } from '@/core/auth/messages';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Input } from '@/ui/Input';

/** Props for SignInAgainDialog. */
export interface SignInAgainDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Closes it without signing in. */
  onClose: () => void;
  /** Called after a successful sign-in (the dialog closes). */
  onSignedIn: () => void;
}

/**
 * The dialog: email, password, Sign in.
 *
 * @param props See SignInAgainDialogProps.
 * @returns The dialog.
 * Rendered by: LiveAnswers.tsx
 */
export function SignInAgainDialog({ open, onClose, onSignedIn }: SignInAgainDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Sends the email and password to Better Auth; on success the new session cookie is set and
   * the call continues.
   *
   * @param event The form's submit event (the page reload is prevented).
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    // Loaded only when used: the auth client starts session requests as soon as it is imported.
    const { signIn } = await import('@/core/auth/authClient');
    const result = await signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    setPending(false);
    if (result.error) {
      setError(messageFor(result.error.code));
      return;
    }
    onSignedIn();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Sign in again">
      <p className="mb-4 text-sm text-ui-text">
        Your sign-in has expired. Sign in to keep getting answers. This call, its transcript and its
        answers stay as they are.
      </p>
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
          <p role="alert" className="text-sm text-ui-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Dialog>
  );
}
