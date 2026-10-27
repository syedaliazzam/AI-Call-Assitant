/**
 * File: apps/web/app/change-password/actions.ts
 * Purpose: Server action behind the change-password form: checks the input, asks Better Auth
 *          to change the password, clears `mustChangePassword`, then opens the dashboard.
 * Used by: app/change-password/page.tsx (passed to ChangePasswordForm)
 * Depends on: src/server/auth.ts, src/server/users.ts, zod
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (first sign-in)
 */
'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ChangePasswordState } from '@/features/auth/types';
import { auth, getSession } from '@/server/auth';
import { markPasswordChanged } from '@/server/users';

/** Rules for the form fields. 10 matches minPasswordLength in src/server/auth.ts. */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters.')
      .max(128, 'Use at most 128 characters.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two new passwords do not match.',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one.',
  });

/**
 * Changes the signed-in user's password.
 * Other devices are signed out (revokeOtherSessions); this device gets a fresh session cookie
 * through the nextCookies() plugin.
 *
 * @param _previous Previous form state (required by useActionState; not used).
 * @param formData  The submitted form: currentPassword, newPassword, confirmPassword.
 * @returns Error messages for the form; on success it redirects to '/' instead of returning.
 * Called from: ChangePasswordForm (src/features/auth/ChangePasswordForm.tsx) via useActionState
 */
export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await getSession();
  if (!session) redirect('/login');

  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: ChangePasswordState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof NonNullable<ChangePasswordState['fieldErrors']>;
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors };
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError && error.body?.code === 'INVALID_PASSWORD') {
      return { fieldErrors: { currentPassword: 'Current password is incorrect.' } };
    }
    // Log only the user id and error code, never passwords.
    console.error('change-password failed', {
      userId: session.user.id,
      code: error instanceof APIError ? error.body?.code : 'unknown',
    });
    return { error: 'Could not change the password. Please try again.' };
  }

  await markPasswordChanged(session.user.id);
  // redirect() works by throwing, so it must stay outside the try/catch above.
  redirect('/');
}
