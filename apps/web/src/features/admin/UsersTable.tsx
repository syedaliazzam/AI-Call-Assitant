/**
 * File: apps/web/src/features/admin/UsersTable.tsx
 * Purpose: Table of all accounts with their status and row actions: reset password,
 *          disable/enable, make admin/user. A new temporary password is shown once above the table.
 * Used by: app/(app)/admin/users/page.tsx
 * Depends on: src/features/admin/types.ts, TemporaryPasswordBox.tsx, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2
 */
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/ui/Button';
import { TemporaryPasswordBox } from './TemporaryPasswordBox';
import type { AdminActionResult, AdminUserActions, UserRow } from './types';

/** Props for UsersTable. */
export interface UsersTableProps {
  /** Every account, newest first. */
  users: UserRow[];
  /** The signed-in admin's id; their own row has no action buttons (no self-lockout). */
  currentUserId: string;
  /** Server actions for the row buttons. */
  actions: Pick<AdminUserActions, 'resetPassword' | 'setDisabled' | 'setRole'>;
}

/**
 * A coloured badge with the account's status.
 *
 * @param props.user The row to describe.
 * @returns The badge element.
 */
function StatusBadge({ user }: { user: UserRow }) {
  if (user.disabled) {
    return <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Disabled</span>;
  }
  if (user.mustChangePassword) {
    return (
      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
        Must change password
      </span>
    );
  }
  return <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Active</span>;
}

/**
 * Formats a date as YYYY-MM-DD (UTC). A fixed format avoids differences between the server's
 * and the browser's locale, which would cause React hydration warnings.
 *
 * @param date The date to format.
 * @returns For example '2026-10-26'.
 */
function formatDate(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Table of all accounts with row actions: reset the password, disable or enable, make admin
 * or user. Actions that sign the person out ask for confirmation first.
 *
 * @param props See UsersTableProps.
 * @returns The table section.
 * Rendered by: app/(app)/admin/users/page.tsx
 */
export function UsersTable({ users, currentUserId, actions }: UsersTableProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);

  /**
   * Runs one row action, then shows its error or (for resets) the new password.
   * The server action refreshes the page data itself (revalidatePath).
   *
   * @param user The row the action is for.
   * @param run  Calls the server action.
   */
  function runAction(user: UserRow, run: () => Promise<AdminActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setError(result.error);
      } else if (result.temporaryPassword) {
        setRevealed({ email: user.email, password: result.temporaryPassword });
      }
    });
  }

  /**
   * Asks for confirmation, then resets the user's password (it signs them out).
   *
   * @param user The table row.
   */
  function handleReset(user: UserRow) {
    if (!window.confirm(`Reset the password for ${user.email}? They will be signed out.`)) return;
    runAction(user, () => actions.resetPassword(user.id));
  }

  /**
   * Asks for confirmation when disabling (it signs them out), then disables or enables.
   *
   * @param user The table row.
   */
  function handleToggleDisabled(user: UserRow) {
    if (!user.disabled && !window.confirm(`Disable ${user.email}? They will be signed out.`)) {
      return;
    }
    runAction(user, () => actions.setDisabled(user.id, !user.disabled));
  }

  /**
   * Switches the account between admin and user.
   *
   * @param user The table row.
   */
  function handleToggleRole(user: UserRow) {
    runAction(user, () => actions.setRole(user.id, user.role === 'admin' ? 'user' : 'admin'));
  }

  return (
    <section className="flex flex-col gap-4">
      {revealed && (
        <TemporaryPasswordBox
          email={revealed.email}
          password={revealed.password}
          onDismiss={() => setRevealed(null)}
        />
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <tr key={user.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {user.name}
                    {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{user.role}</td>
                  <td className="px-4 py-3">
                    <StatusBadge user={user} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-3">
                    {/* No actions on your own row: resetting, disabling or demoting yourself
                        would sign you out or lock you out. Use /change-password instead. */}
                    {!isSelf && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => handleReset(user)}
                        >
                          Reset password
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => handleToggleDisabled(user)}
                        >
                          {user.disabled ? 'Enable' : 'Disable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => handleToggleRole(user)}
                        >
                          {user.role === 'admin' ? 'Make user' : 'Make admin'}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
