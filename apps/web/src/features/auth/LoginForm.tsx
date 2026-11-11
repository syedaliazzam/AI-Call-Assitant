/**
 * File: apps/web/src/features/auth/LoginForm.tsx
 * Purpose: Email + password sign-in form. No sign-up link: accounts are created by an admin.
 *          ADR-0071: each field shows its own message under it, a wrong email or password shows one
 *          message at the top, the password has a show/hide button, and Sign in is a 52 px button
 *          that shows a spinner while it waits.
 * Used by: app/login/page.tsx
 * Depends on: lucide-react, src/core/auth/authClient.ts, src/core/auth/messages.ts, src/ui/Button.tsx,
 *             src/ui/Input.tsx, src/platform (hasHomePanel)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in), §8.2; ADR-0071
 *
 * The email and password are only sent to Better Auth; they are never logged or kept.
 */
'use client';

import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { signIn } from '@/core/auth/authClient';
import { messageFor, signInFieldErrors, type SignInFieldErrors } from '@/core/auth/messages';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

/**
 * Never changes: whether the page is hydrated is read once (useSyncExternalStore's server value is false).
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: LoginForm
 */
const subscribeNever = () => () => undefined;

/**
 * The sign-in form. On success it opens the dashboard; the server then sends users who still
 * have a temporary password to /change-password.
 *
 * @returns The form element.
 * Rendered by: app/login/page.tsx
 */
export function LoginForm() {
  const router = useRouter();
  // The message for a refused sign-in (wrong email or password, a disabled account), shown at the top.
  const [error, setError] = useState<string | null>(null);
  // The messages under each field, from the checks made before sending.
  const [fieldErrors, setFieldErrors] = useState<SignInFieldErrors>({});
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // False in the server's HTML until React has taken over the page: until then the button stays
  // disabled, so a press can never submit the form natively (see the form's method below).
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  /**
   * Checks the fields, then sends the email and password to Better Auth and reacts to the result.
   *
   * @param event The form's submit event (the browser's own page reload is prevented).
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const problems = signInFieldErrors(email, password);
    setFieldErrors(problems);
    if (problems.email || problems.password) {
      setError(null);
      // The keyboard goes to the first field to fix, so the message under it is read out with it.
      const first = problems.email ? 'email' : 'password';
      formElement.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
      return;
    }
    setPending(true);
    setError(null);
    const result = await signIn.email({ email: email.trim(), password });
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

  /**
   * Clears a field's message once the user changes it.
   *
   * @param field Which field changed.
   */
  function clearFieldError(field: keyof SignInFieldErrors) {
    if (fieldErrors[field]) setFieldErrors((was) => ({ ...was, [field]: undefined }));
  }

  return (
    // method="post": should the form ever submit before the page's script runs (a slow load), the
    // browser posts it to this page instead of putting the email and password in the address (a GET),
    // where they would reach the browser's history and the server's request logs.
    <form method="post" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {error && (
        <p
          role="alert"
          className="rounded-control bg-ui-danger-bg px-3 py-2.5 text-[14px] text-ui-danger"
        >
          {error}
        </p>
      )}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        className="h-11"
        onChange={() => clearFieldError('email')}
        {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
      />
      <div className="flex flex-col gap-2">
        <Input
          label="Password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          required
          className="h-11"
          onChange={() => clearFieldError('password')}
          {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
          end={
            <button
              type="button"
              onClick={() => setShowPassword((was) => !was)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              // 44 px on a touch screen (the field is 44 tall there too), 36 with a mouse.
              className="inline-flex size-9 pointer-coarse:size-11 items-center justify-center text-ui-muted hover:bg-ui-hover hover:text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" size={18} strokeWidth={1.75} />
              ) : (
                <Eye aria-hidden="true" size={18} strokeWidth={1.75} />
              )}
            </button>
          }
        />
        <p className="text-[13px] text-ui-muted">Forgot password? Ask your admin to reset it.</p>
      </div>
      <Button
        type="submit"
        size="lg"
        className="mt-2 w-full"
        disabled={pending || !hydrated}
        aria-busy={pending}
      >
        {pending && (
          <LoaderCircle aria-hidden="true" size={18} strokeWidth={2} className="animate-spin" />
        )}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
