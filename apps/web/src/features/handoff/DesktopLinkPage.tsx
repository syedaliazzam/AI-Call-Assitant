/**
 * File: apps/web/src/features/handoff/DesktopLinkPage.tsx
 * Purpose: The desktop app's landing page for a paramountai://session/<id>/<code> link (ADR-0052).
 *          It takes the one-time code from the shell (never from the address), looks at whose it is,
 *          and then:
 *          - already signed in as that account: goes straight to the session's start card;
 *          - signed out: uses the code to sign in, then goes to the start card;
 *          - signed in as ANOTHER account: asks first ("This link is for … Switch?"); Stay keeps the
 *            current account and opens the panel.
 *          A used or expired code says so, with the way back. Nothing here starts a call.
 * Used by: app/desktop/link/page.tsx
 * Depends on: src/core/auth/desktopLink.ts, src/platform (consumeLinkCode), src/ui (Button)
 * Architecture: ADR-0052
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { peekLinkCode, redeemLinkCode, signedInEmail } from '@/core/auth/desktopLink';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';

/** What the page shows. */
type LinkState =
  | {
      /** Checking the code. */
      step: 'checking';
    }
  | {
      /** Signed in as someone else: ask before switching. */
      step: 'switch';
      /** The code (kept in memory only, for the Switch button). */
      code: string;
      /** The link's account. */
      linkEmail: string;
      /** The account signed in now. */
      currentEmail: string;
    }
  | {
      /** The code cannot be used (used, expired, or no code). */
      step: 'invalid';
    };

/**
 * Goes to the panel, on the session's start card.
 *
 * @param sessionId The session, or null for the plain panel.
 */
function goHome(sessionId: string | null): void {
  window.location.replace(sessionId ? `/home?session=${encodeURIComponent(sessionId)}` : '/home');
}

/**
 * The page.
 *
 * @param props.sessionId The session the link names (from the address; checked by the server again).
 * @returns The page.
 * Rendered by: app/desktop/link/page.tsx
 */
export function DesktopLinkPage({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<LinkState>({ step: 'checking' });
  const started = useRef(false);

  useEffect(() => {
    // Once: the shell hands the code over a single time.
    if (started.current) return;
    started.current = true;
    void (async () => {
      const code = await getPlatform().consumeLinkCode();
      if (!code) {
        // No code (an older link, or a reload): the panel opens the session if this account has it.
        goHome(sessionId);
        return;
      }
      const [owner, current] = await Promise.all([peekLinkCode(code), signedInEmail()]);
      if (!owner || owner.sessionId !== sessionId) {
        setState({ step: 'invalid' });
        return;
      }
      if (current && current.toLowerCase() === owner.email.toLowerCase()) {
        // Already this account: no need to use the code.
        goHome(sessionId);
        return;
      }
      if (current) {
        setState({ step: 'switch', code, linkEmail: owner.email, currentEmail: current });
        return;
      }
      if (await redeemLinkCode(code, sessionId)) goHome(sessionId);
      else setState({ step: 'invalid' });
    })();
  }, [sessionId]);

  /**
   * Switches to the link's account.
   *
   * @param code The code.
   */
  const switchAccount = async (code: string) => {
    setState({ step: 'checking' });
    if (await redeemLinkCode(code, sessionId)) goHome(sessionId);
    else setState({ step: 'invalid' });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ui-bg p-6 text-center text-ui-text">
      <h1 className="text-[17px] font-semibold text-ui-heading">Opening your session</h1>
      {state.step === 'checking' && (
        <p role="status" className="text-[14px] text-ui-muted">
          Signing in…
        </p>
      )}
      {state.step === 'switch' && (
        <div className="flex max-w-sm flex-col gap-3">
          <p className="text-[14px]">
            This link is for <strong>{state.linkEmail}</strong>. This app is signed in as{' '}
            <strong>{state.currentEmail}</strong>. Switch to {state.linkEmail}?
          </p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => void switchAccount(state.code)}>Switch</Button>
            <Button variant="secondary" onClick={() => goHome(null)}>
              Stay signed in
            </Button>
          </div>
        </div>
      )}
      {state.step === 'invalid' && (
        <div className="flex max-w-sm flex-col gap-3">
          <p role="alert" className="text-[14px]">
            This link has already been used or has expired. Open the session again from the
            dashboard in your browser.
          </p>
          <Button variant="secondary" onClick={() => goHome(null)}>
            Continue
          </Button>
        </div>
      )}
    </main>
  );
}
