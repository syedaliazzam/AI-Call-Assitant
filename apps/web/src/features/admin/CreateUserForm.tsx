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
 * The create-user form (name, email, role). After a successful submit it shows the
 * server-generated temporary password once, so the admin can pass it on.
 *
 * @param props.action The server action to submit to.
 * @returns The form section.
 * Rendered by: app/(app)/admin/users/page.tsx
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
    <section className="border border-ui-border bg-ui-surface p-6">
      <h2 className="text-[20px] text-ui-subheading">Create user</h2>
      <form
        ref={formRef}
        action={formAction}
        // Two columns up to 1024 px (Kite docked beside a meeting), four from there; minmax(0, 1fr)
        // lets the inputs shrink instead of pushing the page sideways.
        className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto] lg:items-start"
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
          <label
            htmlFor="create-user-role"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted"
          >
            Role
          </label>
          <select
            id="create-user-role"
            name="role"
            defaultValue="user"
            className="h-10 border border-ui-border bg-ui-input px-3 text-base text-ui-text focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 md:text-[15px]"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {/* lg:mt-5 moves the button down by one label height, in line with the inputs. */}
        <Button type="submit" disabled={pending} className="self-end lg:mt-5 lg:self-start">
          {pending ? 'Creating…' : 'Create user'}
        </Button>
      </form>
      {state.status === 'error' && state.error && (
        <p role="alert" className="mt-4 bg-ui-danger-bg px-3 py-2 text-sm text-ui-danger">
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
