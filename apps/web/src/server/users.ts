/**
 * File: apps/web/src/server/users.ts
 * Purpose: Create and manage Kite user accounts (admin actions) and mark password changes.
 *          Thin wrappers over Better Auth's admin API; each admin call passes the request
 *          headers so Better Auth itself checks that the caller is a signed-in admin.
 * Used by: app/(app)/admin/users/actions.ts, app/(app)/admin/users/page.tsx,
 *          app/change-password/actions.ts
 * Depends on: src/server/auth.ts (Better Auth instance), src/server/db.ts, src/server/schema.ts,
 *             src/server/passwords.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (ADR-0022)
 */
import 'server-only';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import { generateTemporaryPassword } from './passwords';
import { user } from './schema';

/** A role a Kite account can have. */
export type UserRole = 'admin' | 'user';

/** One account as shown in the admin users table. */
export interface UserAccount {
  /** Better Auth user id. */
  id: string;
  /** Display name. */
  name: string;
  /** Login email (lower-case). */
  email: string;
  /** 'admin' or 'user'. */
  role: UserRole;
  /** True when an admin has disabled the account. */
  disabled: boolean;
  /** True until the user replaces their temporary password. */
  mustChangePassword: boolean;
  /** When the account was created. */
  createdAt: Date;
}

/** Input for createUserAccount(). */
export interface NewUserInput {
  /** Display name shown in the app. */
  name: string;
  /** Login email; stored lower-case. */
  email: string;
  /** 'admin' or 'user'. */
  role: UserRole;
}

/** Result of creating an account. */
export interface CreatedUser {
  /** The new user's id. */
  id: string;
  /** The one-time temporary password to share with the person. It is not stored anywhere. */
  temporaryPassword: string;
}

/** Most accounts listed at once. Kite is a small internal tool, so one page is enough. */
const LIST_LIMIT = 500;

/** Ban reason stored when an admin disables an account. */
const DISABLED_REASON = 'Disabled by an admin';

/**
 * Lists every account, newest first.
 *
 * @param headers The admin's request headers (Better Auth checks the caller is an admin).
 * @returns The accounts.
 * @throws APIError from Better Auth if the caller is not a signed-in admin.
 * Called from: app/(app)/admin/users/page.tsx
 */
export async function listUserAccounts(headers: Headers): Promise<UserAccount[]> {
  const result = await auth.api.listUsers({
    query: { limit: LIST_LIMIT, sortBy: 'createdAt', sortDirection: 'desc' },
    headers,
  });
  return result.users.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    disabled: row.banned === true,
    // listUsers returns the plain database row, which includes our additional field.
    mustChangePassword: (row as { mustChangePassword?: boolean }).mustChangePassword !== false,
    createdAt: new Date(row.createdAt),
  }));
}

/**
 * Creates a new user account with a temporary password (admin only).
 * The user must change this password at first sign-in (mustChangePassword = true).
 *
 * @param input   Name, email and role of the new account.
 * @param headers The admin's request headers; omit only from scripts/create-admin.ts, where
 *                there is no request (Better Auth allows server-side calls without headers).
 * @returns The created user's id and the one-time temporary password to share with the person.
 * @throws Error('EMAIL_TAKEN') if an account with this email already exists.
 * @throws APIError from Better Auth if the caller is not an admin or the input is invalid.
 * Called from: createUserAction() in app/(app)/admin/users/actions.ts, scripts/create-admin.ts
 */
export async function createUserAccount(
  input: NewUserInput,
  headers?: Headers,
): Promise<CreatedUser> {
  const temporaryPassword = generateTemporaryPassword();
  try {
    const result = await auth.api.createUser({
      body: {
        name: input.name,
        email: input.email.toLowerCase(),
        password: temporaryPassword,
        role: input.role,
        data: { mustChangePassword: true },
      },
      ...(headers ? { headers } : {}),
    });
    return { id: result.user.id, temporaryPassword };
  } catch (error) {
    if (error instanceof APIError && error.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      throw new Error('EMAIL_TAKEN');
    }
    throw error;
  }
}

/**
 * Gives a user a new temporary password (admin only). The user is signed out everywhere and
 * must change the password at their next sign-in.
 *
 * @param userId  The account to reset.
 * @param headers The admin's request headers.
 * @returns The one-time temporary password to share with the person.
 * @throws APIError from Better Auth if the caller is not an admin or the user does not exist.
 * Called from: resetPasswordAction() in app/(app)/admin/users/actions.ts
 */
export async function resetUserPassword(userId: string, headers: Headers): Promise<string> {
  const temporaryPassword = generateTemporaryPassword();
  await auth.api.setUserPassword({ body: { userId, newPassword: temporaryPassword }, headers });
  await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, userId));
  // Sign the user out everywhere: whoever knew the old password should lose access now.
  await auth.api.revokeUserSessions({ body: { userId }, headers });
  return temporaryPassword;
}

/**
 * Disables or re-enables an account (admin only). Disabling uses Better Auth's ban, which also
 * deletes all the user's sessions, so they are signed out on their next request.
 *
 * @param userId   The account to change.
 * @param disabled True to disable, false to enable again.
 * @param headers  The admin's request headers.
 * @throws APIError from Better Auth if the caller is not an admin, the user does not exist,
 *         or an admin tries to disable their own account.
 * Called from: toggleDisabledAction() in app/(app)/admin/users/actions.ts
 */
export async function setUserDisabled(
  userId: string,
  disabled: boolean,
  headers: Headers,
): Promise<void> {
  if (disabled) {
    await auth.api.banUser({ body: { userId, banReason: DISABLED_REASON }, headers });
  } else {
    await auth.api.unbanUser({ body: { userId }, headers });
  }
}

/**
 * Changes an account's role (admin only).
 *
 * @param userId  The account to change.
 * @param role    The new role.
 * @param headers The admin's request headers.
 * @throws APIError from Better Auth if the caller is not an admin or the user does not exist.
 * Called from: setRoleAction() in app/(app)/admin/users/actions.ts
 */
export async function setUserRole(userId: string, role: UserRole, headers: Headers): Promise<void> {
  await auth.api.setRole({ body: { userId, role }, headers });
}

/**
 * Records that a user has replaced their temporary password, so the guard stops sending them
 * to /change-password. Writes the database directly because the field is not user-editable
 * through Better Auth (input: false in src/server/auth.ts).
 *
 * @param userId The user who just changed their password.
 * Called from: changePasswordAction() in app/change-password/actions.ts, after Better Auth
 *              has accepted the change
 */
export async function markPasswordChanged(userId: string): Promise<void> {
  await db.update(user).set({ mustChangePassword: false }).where(eq(user.id, userId));
}
