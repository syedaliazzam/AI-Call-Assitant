/**
 * File: apps/web/src/core/auth/messages.ts
 * Purpose: The sign-in error messages shown to users, shared by the sign-in page and the
 *          in-call "Sign in again" dialog (Day 6 Stage 4e), and the sign-in form's own field checks
 *          (ADR-0071: shown under each field before anything is sent).
 * Used by: src/features/auth/LoginForm.tsx, src/features/live/SignInAgainDialog.tsx
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts); ADR-0022, ADR-0071
 */

/**
 * Turns a Better Auth error code into a message for the user.
 * Wrong email and wrong password get the same message, so the form does not reveal which
 * emails have accounts.
 *
 * @param code Better Auth error code, for example 'BANNED_USER'.
 * @returns The message to show.
 * Called from: LoginForm's submit handler; SignInAgainDialog.tsx (signing in again during a call)
 */
export function messageFor(code: string | undefined): string {
  if (code === 'BANNED_USER') return 'This account is disabled. Ask an admin to enable it.';
  if (code === 'INVALID_EMAIL_OR_PASSWORD') return 'Email or password is incorrect.';
  return 'Sign-in failed. Please try again.';
}

/** What is wrong with each sign-in field; a field that is fine is absent. */
export interface SignInFieldErrors {
  /** The email field's message. */
  email?: string;
  /** The password field's message. */
  password?: string;
}

/**
 * A loose email shape check: something, an @, something, a dot, something. The server decides
 * whether the account exists; this only catches an empty field or an obvious typo before sending.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks the sign-in form's fields before anything is sent.
 *
 * @param email    The email as typed (spaces at the ends are ignored).
 * @param password The password as typed (never trimmed: spaces may be part of it).
 * @returns A message per field that needs fixing; an empty object when both are fine.
 * Called from: LoginForm's submit handler; tests
 */
export function signInFieldErrors(email: string, password: string): SignInFieldErrors {
  const errors: SignInFieldErrors = {};
  const trimmed = email.trim();
  if (trimmed === '') errors.email = 'Enter your email.';
  else if (!EMAIL_SHAPE.test(trimmed)) errors.email = 'Enter a valid email address.';
  if (password === '') errors.password = 'Enter your password.';
  return errors;
}
