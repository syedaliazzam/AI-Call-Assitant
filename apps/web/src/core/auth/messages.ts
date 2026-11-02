/**
 * File: apps/web/src/core/auth/messages.ts
 * Purpose: The sign-in error messages shown to users, shared by the sign-in page and the
 *          in-call "Sign in again" dialog (Day 6 Stage 4e).
 * Used by: src/features/auth/LoginForm.tsx, src/features/live/SignInAgainDialog.tsx
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts); ADR-0022
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
