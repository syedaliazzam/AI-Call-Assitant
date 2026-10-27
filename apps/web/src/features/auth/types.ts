/**
 * File: apps/web/src/features/auth/types.ts
 * Purpose: Shapes shared by the change-password form (client) and its server action.
 * Used by: src/features/auth/ChangePasswordForm.tsx, app/change-password/actions.ts
 * Depends on: nothing (types only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2
 */

/** What the change-password action reports back to the form. On success it redirects instead. */
export interface ChangePasswordState {
  /** Message for the whole form, for example "Current password is incorrect". */
  error?: string;
  /** Messages for single fields, keyed by the input's name. */
  fieldErrors?: Partial<Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>>;
}

/** Signature of the change-password server action (used with React's useActionState). */
export type ChangePasswordAction = (
  previous: ChangePasswordState,
  formData: FormData,
) => Promise<ChangePasswordState>;
