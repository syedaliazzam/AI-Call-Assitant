/**
 * File: apps/web/src/features/auth/ChangePasswordForm.tsx
 * Purpose: Form to replace the temporary password: current password, new password, confirm.
 *          The work happens in a server action passed in by the page.
 * Used by: app/change-password/page.tsx
 * Depends on: src/features/auth/types.ts, src/ui/Button.tsx, src/ui/Input.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Change password), §8.2
 */
'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import type { ChangePasswordAction, ChangePasswordState } from './types';

/** Props for ChangePasswordForm. */
export interface ChangePasswordFormProps {
  /** Server action that changes the password (app/change-password/actions.ts). */
  action: ChangePasswordAction;
}

/** Form state before the first submit. */
const INITIAL_STATE: ChangePasswordState = {};

/**
 * The change-password form. On success the action redirects to the dashboard, so this
 * component only ever shows errors.
 *
 * @param props.action The server action to submit to.
 * @returns The form element.
 * Rendered by: app/change-password/page.tsx
 */
export function ChangePasswordForm({ action }: ChangePasswordFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Input
        label="Current (temporary) password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        error={state.fieldErrors?.currentPassword}
      />
      <Input
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        required
        error={state.fieldErrors?.newPassword}
      />
      <Input
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />
      {state.error && (
        <p
          role="alert"
          className="rounded-control bg-ui-danger-bg px-3 py-2 text-[13px] text-ui-danger"
        >
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}
