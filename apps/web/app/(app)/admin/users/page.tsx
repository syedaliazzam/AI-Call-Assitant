/**
 * File: apps/web/app/(app)/admin/users/page.tsx
 * Purpose: The /admin/users route: lists accounts and lets the admin create and manage them.
 *          Kept thin: loads the data and passes it, with the server actions, to the feature UI.
 * Used by: Next.js App Router (admins only, see ../layout.tsx)
 * Depends on: src/server/guard.ts, src/server/users.ts, src/features/admin/*, ./actions.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2
 */
import { headers } from 'next/headers';
import { CreateUserForm } from '@/features/admin/CreateUserForm';
import { UsersTable } from '@/features/admin/UsersTable';
import { requireAdmin } from '@/server/guard';
import { listUserAccounts } from '@/server/users';
import {
  createUserAction,
  resetPasswordAction,
  setRoleAction,
  toggleDisabledAction,
} from './actions';

/**
 * Admin users page.
 *
 * @returns The create form and the users table.
 */
export default async function AdminUsersPage() {
  // The layout already checked; this call is cached per request and gives us the admin's id.
  const session = await requireAdmin();
  const users = await listUserAccounts(await headers());

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create accounts and share the temporary password with each person directly.
        </p>
      </header>
      <CreateUserForm action={createUserAction} />
      <UsersTable
        users={users}
        currentUserId={session.user.id}
        actions={{
          resetPassword: resetPasswordAction,
          setDisabled: toggleDisabledAction,
          setRole: setRoleAction,
        }}
      />
    </div>
  );
}
