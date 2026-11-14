/**
 * File: apps/web/src/features/admin/AddUserDialog.tsx
 * Purpose: The Add user dialog (name, email, role), opened from the header's "Add user". It submits to
 *          the same server action as before (createUserAction): the server creates the account with a
 *          temporary password, which the dialog then shows once, to pass on.
 * Used by: src/features/admin/UsersPage.tsx
 * Depends on: src/features/admin/types.ts, TemporaryPasswordBox.tsx, src/ui (Button, Dialog, Input,
 *             Select)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2 (ADR-0022)
 */
'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TemporaryPasswordBox } from './TemporaryPasswordBox';
import type { AdminUserActions, CreateUserState, Role } from './types';

/** Props for AddUserDialog. */
export interface AddUserDialogProps {
  /** True to show it. */
  open: boolean;
  /** Closes it. */
  onClose: () => void;
  /** Server action that creates the account (createUserAction). */
  action: AdminUserActions['createUser'];
  /** Called once an account was created, with its email (for the toast). */
  onCreated: (email: string) => void;
}

/** Form state before the first submit. */
const INITIAL_STATE: CreateUserState = { status: 'idle' };

/** The roles an account can have. */
const ROLE_OPTIONS: readonly { value: Role; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

/** The form's id, so the footer's button (outside the form) submits it. */
const FORM_ID = 'add-user-form';

/**
 * The dialog. Each opening starts a fresh form (the inner part is keyed by the opening).
 *
 * @param props See AddUserDialogProps.
 * @returns The dialog (hidden while closed).
 * Rendered by: UsersPage.tsx
 */
export function AddUserDialog({ open, onClose, action, onCreated }: AddUserDialogProps) {
  const [opening, setOpening] = useState(0);
  // A new opening gets a new form: no old password or field message left from the last one.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((count) => count + 1);
  }
  return (
    <AddUserForm
      key={opening}
      open={open}
      onClose={onClose}
      action={action}
      onCreated={onCreated}
      onAnother={() => setOpening((count) => count + 1)}
    />
  );
}

/**
 * The dialog's form, then the one-time password once the account exists.
 *
 * @param props See AddUserDialogProps, plus onAnother (clears the form for another account).
 * @returns The dialog.
 * Rendered by: AddUserDialog
 */
function AddUserForm({
  open,
  onClose,
  action,
  onCreated,
  onAnother,
}: AddUserDialogProps & {
  /** Starts a new, empty form. */
  onAnother: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [role, setRole] = useState<Role>('user');
  const errors = state.status === 'error' ? state.fieldErrors : undefined;
  const created = state.status === 'created' ? state : null;

  // Tell the page once per created account (the toast).
  useEffect(() => {
    if (created) onCreated(created.email);
  }, [created, onCreated]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={created ? 'Account created' : 'Add user'}
      footer={
        created ? (
          <>
            <Button variant="ghost" onClick={onAnother}>
              Add another
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} disabled={pending}>
              {pending ? 'Creating…' : 'Create account'}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <TemporaryPasswordBox email={created.email} password={created.temporaryPassword} />
      ) : (
        <form id={FORM_ID} action={formAction} className="flex flex-col gap-4" noValidate>
          <p className="text-helper text-ui-muted">
            The account gets a temporary password, shown once on the next screen. Share it with the
            person directly; they choose their own when they first sign in.
          </p>
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
          {state.status === 'error' && state.error && (
            <p
              role="alert"
              className="rounded-control bg-ui-danger-bg px-3 py-2 text-[13px] text-ui-danger"
            >
              {state.error}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}
