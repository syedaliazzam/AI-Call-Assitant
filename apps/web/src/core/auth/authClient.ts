/**
 * File: apps/web/src/core/auth/authClient.ts
 * Purpose: The browser side of Better Auth: sign in, sign out and the current session.
 *          It calls /api/auth/* on the same origin (also inside the desktop app's window).
 * Used by: src/features/auth/LoginForm.tsx, src/features/auth/SignOutButton.tsx
 * Depends on: better-auth/react, better-auth/client/plugins
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2
 */
import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * The Better Auth browser client. No baseURL is given, so it uses the page's own origin;
 * that works the same on localhost, preview and production URLs.
 * adminClient() adds the admin endpoints' types (Kite calls them from server actions instead).
 */
export const authClient = createAuthClient({
  plugins: [adminClient()],
});

/**
 * Signs in with email and password: `signIn.email({ email, password })`.
 * Resolves to `{ data, error }`; `error.code` is 'INVALID_EMAIL_OR_PASSWORD' or 'BANNED_USER'.
 */
export const signIn = authClient.signIn;

/** Signs out and deletes this device's session: `signOut()`. */
export const signOut = authClient.signOut;

/** React hook with the current session: `const { data, isPending } = useSession()`. */
export const useSession = authClient.useSession;
