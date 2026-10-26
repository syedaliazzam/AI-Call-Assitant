/**
 * File: apps/web/app/(app)/admin/users/actions.ts
 * Purpose: Server actions behind the admin users screen. Each one checks the caller is an
 *          admin (requireAdmin), validates its input with zod, calls src/server/users.ts and
 *          returns a result object; errors are returned, never thrown to the UI.
 * Used by: app/(app)/admin/users/page.tsx (passed to CreateUserForm and UsersTable)
 * Depends on: src/server/guard.ts, src/server/users.ts, zod
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2
 */
'use server';

import { APIError } from 'better-auth/api';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { AdminActionResult, CreateUserState, Role } from '@/features/admin/types';
import { requireAdmin } from '@/server/guard';
import { createUserAccount, resetUserPassword, setUserDisabled, setUserRole } from '@/server/users';

/** The page these actions change; refreshed after every successful change. */
const USERS_PATH = '/admin/users';

/** Rules for the create-user form. */
const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use at most 100 characters.'),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  role: z.enum(['admin', 'user'], 'Choose a role.'),
});

/** A user id from the table (Better Auth ids are short random strings). */
const userIdSchema = z.string().min(1).max(100);

/** A role sent by a row button. */
const roleSchema = z.enum(['admin', 'user']);

/**
 * Logs a failed admin action without personal data (ids and error codes only), and returns
 * the message to show.
 *
 * @param action Name of the action, for example 'setRole'.
 * @param userId The target user's id.
 * @param error  What was thrown.
 * @returns A short message for the admin.
 * Called from: every action below
 */
function failure(action: string, userId: string, error: unknown): AdminActionResult {
  const code = error instanceof APIError ? error.body?.code : undefined;
  console.error('admin action failed', { action, userId, code: code ?? 'unknown' });
  if (code === 'USER_NOT_FOUND') return { ok: false, error: 'That user no longer exists.' };
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

/**
 * Creates an account with a generated temporary password.
 *
 * @param _previous Previous form state (required by useActionState; not used).
 * @param formData  The submitted form: name, email, role.
 * @returns 'created' with the one-time password, or 'error' with messages.
 * Called from: CreateUserForm (src/features/admin/CreateUserForm.tsx) via useActionState
 */
export async function createUserAction(
  _previous: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  await requireAdmin();
  const parsed = createUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Extract<CreateUserState, { status: 'error' }>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'name' | 'email' | 'role';
      fieldErrors[field] ??= issue.message;
    }
    return { status: 'error', fieldErrors };
  }

  try {
    const created = await createUserAccount(parsed.data, await headers());
    revalidatePath(USERS_PATH);
    return {
      status: 'created',
      email: parsed.data.email,
      temporaryPassword: created.temporaryPassword,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_TAKEN') {
      return {
        status: 'error',
        fieldErrors: { email: 'An account with this email already exists.' },
      };
    }
    const result = failure('createUser', 'new', error);
    return { status: 'error', error: result.ok ? undefined : result.error };
  }
}

/**
 * Checks the target is a valid id and not the admin themself (no self-lockout).
 *
 * @param adminId The signed-in admin's id.
 * @param userId  The target user's id, as sent by the browser.
 * @returns An error result, or null when the target is fine.
 * Called from: resetPasswordAction(), toggleDisabledAction(), setRoleAction()
 */
function checkTarget(adminId: string, userId: string): AdminActionResult | null {
  if (!userIdSchema.safeParse(userId).success) return { ok: false, error: 'Invalid user.' };
  if (userId === adminId) {
    return { ok: false, error: 'You cannot change your own account here.' };
  }
  return null;
}

/**
 * Gives a user a new temporary password and signs them out everywhere.
 *
 * @param userId The account to reset.
 * @returns ok with the one-time temporary password, or an error message.
 * Called from: UsersTable "Reset password" button
 */
export async function resetPasswordAction(userId: string): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const invalid = checkTarget(session.user.id, userId);
  if (invalid) return invalid;
  try {
    const temporaryPassword = await resetUserPassword(userId, await headers());
    revalidatePath(USERS_PATH);
    return { ok: true, temporaryPassword };
  } catch (error) {
    return failure('resetPassword', userId, error);
  }
}

/**
 * Disables (signs out and blocks) or re-enables an account.
 *
 * @param userId   The account to change.
 * @param disabled True to disable, false to enable.
 * @returns ok, or an error message.
 * Called from: UsersTable "Disable" / "Enable" button
 */
export async function toggleDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const invalid = checkTarget(session.user.id, userId);
  if (invalid) return invalid;
  if (typeof disabled !== 'boolean') return { ok: false, error: 'Invalid request.' };
  try {
    await setUserDisabled(userId, disabled, await headers());
    revalidatePath(USERS_PATH);
    return { ok: true };
  } catch (error) {
    return failure('setDisabled', userId, error);
  }
}

/**
 * Changes an account's role.
 *
 * @param userId The account to change.
 * @param role   'admin' or 'user'.
 * @returns ok, or an error message.
 * Called from: UsersTable "Make admin" / "Make user" button
 */
export async function setRoleAction(userId: string, role: Role): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const invalid = checkTarget(session.user.id, userId);
  if (invalid) return invalid;
  // Server actions can be called with any value, so re-check the role here.
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { ok: false, error: 'Invalid role.' };
  try {
    await setUserRole(userId, parsedRole.data, await headers());
    revalidatePath(USERS_PATH);
    return { ok: true };
  } catch (error) {
    return failure('setRole', userId, error);
  }
}
