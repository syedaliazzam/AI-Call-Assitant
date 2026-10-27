/**
 * File: apps/web/src/features/admin/CreateUserForm.tsx
 * Purpose: Form for an admin to create an account (name, email, role). The server generates a
 *          temporary password, which this form then shows once.
 * Used by: app/(app)/admin/users/page.tsx
 * Depends on: src/features/admin/types.ts, TemporaryPasswordBox.tsx, src/ui/Button.tsx, src/ui/Input.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2
 */
'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { TemporaryPasswordBox } from './TemporaryPasswordBox';
import type { AdminUserActions, CreateUserState } from './types';

/** Props for CreateUserForm. */
export interface CreateUserFormProps {
  /** Server action that creates the account (createUserAction). */
  action: AdminUserActions['createUser'];
}

/** Form state before the first submit. */
const INITIAL_STATE: CreateUserState = { status: 'idle' };

/**
 * The create-user form.
 *
 * @param props.action The server action to submit to.
 * @returns The form section.
 */
export function CreateUserForm({ action }: CreateUserFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.status === 'error' ? state.fieldErrors : undefined;

  // Clear the fields after a successful create, so the next account starts empty.
  useEffect(() => {
    if (state.status === 'created') formRef.current?.reset();
  }, [state]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">Create user</h2>
      <form
        ref={formRef}
        action={formAction}
        className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-start"
        noValidate
      >
        <Input label="Name" name="name" required autoComplete="off" error={errors?.name} />
        <Input
          label="Email"
          name="email"
          type="email"
          required
          autoComplete="off"
          error={errors?.email}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="create-user-role" className="text-sm font-medium text-slate-800">
            Role
          </label>
          <select
            id="create-user-role"
            name="role"
            defaultValue="user"
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {/* sm:mt-6 moves the button down by one label height, in line with the inputs. */}
        <Button type="submit" disabled={pending} className="sm:mt-6">
          {pending ? 'Creating…' : 'Create user'}
        </Button>
      </form>
      {state.status === 'error' && state.error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.status === 'created' && (
        <div className="mt-4">
          <TemporaryPasswordBox email={state.email} password={state.temporaryPassword} />
        </div>
      )}
    </section>
  );
}
