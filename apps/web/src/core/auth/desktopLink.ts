/**
 * File: apps/web/src/core/auth/desktopLink.ts
 * Purpose: Browser side of the one-time desktop sign-in codes (ADR-0052): the browser asks for a code
 *          for a session (put in the paramountai:// link); the desktop app looks at a code (whose it is)
 *          and redeems it (signed in as that account), and reads who it is signed in as now. Codes are
 *          never logged or kept.
 * Used by: src/features/handoff/DesktopHandoffPage.tsx (request), DesktopLinkPage.tsx (peek, redeem)
 * Depends on: browser fetch, src/core/auth/authClient.ts
 * Architecture: ADR-0052
 */
import { authClient } from './authClient';

/** A code for the link. */
export interface LinkCode {
  /** The code (43 characters); put only in the paramountai:// link. */
  code: string;
  /** When it stops working (Unix ms). */
  expiresAt: number;
}

/**
 * Asks for a one-time code for one of this account's sessions.
 *
 * @param sessionId The session the link opens.
 * @returns The code, or null when it cannot be made (not this account's session, too many, offline).
 * Called from: DesktopHandoffPage.tsx
 */
export async function requestLinkCode(sessionId: string): Promise<LinkCode | null> {
  try {
    const response = await fetch('/api/desktop/link-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      cache: 'no-store',
    });
    return response.ok ? ((await response.json()) as LinkCode) : null;
  } catch {
    return null;
  }
}

/**
 * Posts to a desktop-link endpoint.
 *
 * @param path The endpoint under /api/auth.
 * @param body The JSON body.
 * @returns The response, or null on a network failure.
 */
async function post(path: string, body: object): Promise<Response | null> {
  try {
    return await fetch(`/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

/**
 * Looks at a code without using it.
 *
 * @param code The code.
 * @returns The account's email and the session, or null when the code is unknown, used or expired.
 * Called from: DesktopLinkPage.tsx
 */
export async function peekLinkCode(
  code: string,
): Promise<{ email: string; sessionId: string } | null> {
  const response = await post('/desktop-link/peek', { code });
  return response?.ok ? ((await response.json()) as { email: string; sessionId: string }) : null;
}

/**
 * Uses a code: this app is signed in as its account (a session of its own).
 *
 * @param code      The code.
 * @param sessionId The session it was made for.
 * @returns True when signed in; false when the code was refused (used, expired, another session).
 * Called from: DesktopLinkPage.tsx
 */
export async function redeemLinkCode(code: string, sessionId: string): Promise<boolean> {
  const response = await post('/desktop-link/redeem', { code, sessionId });
  return response?.ok ?? false;
}

/**
 * Who this app is signed in as now.
 *
 * @returns The email, or null when signed out.
 * Called from: DesktopLinkPage.tsx
 */
export async function signedInEmail(): Promise<string | null> {
  try {
    const { data } = await authClient.getSession();
    return data?.user.email ?? null;
  } catch {
    return null;
  }
}
