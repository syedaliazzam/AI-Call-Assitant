/**
 * File: apps/web/src/features/admin/CreateUserForm.tsx
 * Purpose: Form for an admin to create an account (name, email, role). The server generates a
 *          temporary password, which this form then shows once.
 * Used by: app/(app)/admin/users/page.tsx
 * Depends on: src/features/admin/types.ts, TemporaryPasswordBox.tsx, src/ui/Button.tsx, src/ui/Input.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2
 */
'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TemporaryPasswordBox } from './TemporaryPasswordBox';
import type { AdminUserActions, CreateUserState, Role } from './types';

/** Props for CreateUserForm. */
export interface CreateUserFormProps {
  /** Server action that creates the account (createUserAction). */
  action: AdminUserActions['createUser'];
}

/** Form state before the first submit. */
const INITIAL_STATE: CreateUserState = { status: 'idle' };

/** The roles an account can have. */
const ROLE_OPTIONS: readonly { value: Role; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

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
  const [role, setRole] = useState<Role>('user');
  const errors = state.status === 'error' ? state.fieldErrors : undefined;

  // Clear the fields after a successful create, so the next account starts empty.
  useEffect(() => {
    if (state.status === 'created') formRef.current?.reset();
  }, [state]);
  // A created account starts the list again too (while rendering: it follows a changed value).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.status === 'created') setRole('user');
  }

  return (
    <section className="border border-ui-border rounded-card bg-ui-surface shadow-card p-6">
      <h2 className="text-[18px] font-semibold text-ui-heading">Create user</h2>
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
        {/* The form sends what the list shows: the list itself holds no form field. */}
        <input type="hidden" name="role" value={role} />
        <Select label="Role" options={ROLE_OPTIONS} value={role} onChange={setRole} />
        {/* Level with the fields, under their labels. */}
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? 'Creating…' : 'Create user'}
        </Button>
      </form>
      {state.status === 'error' && state.error && (
        <p
          role="alert"
          className="mt-4 rounded-control bg-ui-danger-bg px-3 py-2 text-[13px] text-ui-danger"
        >
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
