/**
 * File: apps/web/src/server/desktopLinkPlugin.ts
 * Purpose: The Better Auth endpoints the desktop app uses with a one-time link code (ADR-0052):
 *          - POST /api/auth/desktop-link/peek {code}: whose code this is (the account's email and the
 *            session), without using it, so the app can ask before switching accounts;
 *          - POST /api/auth/desktop-link/redeem {code, sessionId}: uses the code (once, within 60 s,
 *            only for the session it was made for) and signs the app in as that account with a NEW
 *            session of its own (the browser's session is not shared), unless the app is already
 *            signed in as that account. A disabled account, or one that must change its password,
 *            is refused.
 *          Answers name no reason beyond "invalid_code" / "account_unavailable"; codes are never logged.
 * Used by: src/server/auth.ts (plugins)
 * Depends on: better-auth (api, cookies), zod, src/server/desktopLink.ts, src/server/db.ts
 * Architecture: ADR-0052
 */
import 'server-only';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth';
import { z } from 'zod';
import type { CallDataDb } from './calldata/store';
import { peekLinkCode, takeLinkCode } from './desktopLink';

/** The account fields this plugin checks, beyond Better Auth's own user type. */
interface AccountState {
  /** Admin plugin: disabled by an admin. */
  banned?: boolean | null;
  /** Kite: must replace a temporary password first. */
  mustChangePassword?: boolean;
}

/**
 * The plugin.
 *
 * @param db Returns the database (Neon in the app).
 * @returns The Better Auth plugin.
 * Called from: src/server/auth.ts
 */
export function desktopLinkPlugin(db: () => CallDataDb) {
  return {
    id: 'desktop-link',
    endpoints: {
      desktopLinkPeek: createAuthEndpoint(
        '/desktop-link/peek',
        { method: 'POST', body: z.object({ code: z.string().max(100) }) },
        async (ctx) => {
          const binding = await peekLinkCode(db(), ctx.body.code);
          const user = binding
            ? await ctx.context.internalAdapter.findUserById(binding.userId)
            : null;
          if (!binding || !user) throw new APIError('BAD_REQUEST', { message: 'invalid_code' });
          return ctx.json({ email: user.email, sessionId: binding.sessionId });
        },
      ),
      desktopLinkRedeem: createAuthEndpoint(
        '/desktop-link/redeem',
        {
          method: 'POST',
          body: z.object({ code: z.string().max(100), sessionId: z.string().max(100) }),
        },
        async (ctx) => {
          // Used now, whatever happens next: a code is good for one try.
          const binding = await takeLinkCode(db(), ctx.body.code);
          if (!binding || binding.sessionId !== ctx.body.sessionId) {
            throw new APIError('BAD_REQUEST', { message: 'invalid_code' });
          }
          const user = await ctx.context.internalAdapter.findUserById(binding.userId);
          const state = user as (typeof user & AccountState) | null;
          if (!user || state?.banned || state?.mustChangePassword) {
            throw new APIError('FORBIDDEN', { message: 'account_unavailable' });
          }
          const current = await getSessionFromCtx(ctx).catch(() => null);
          if (current?.user.id !== user.id) {
            // A session of the desktop app's own: signing out in the browser does not end it.
            const session = await ctx.context.internalAdapter.createSession(user.id);
            await setSessionCookie(ctx, { session, user });
          }
          console.info('desktop-link: redeemed', { switched: current?.user.id !== user.id });
          return ctx.json({ ok: true, sessionId: binding.sessionId });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
