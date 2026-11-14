/**
 * File: apps/web/app/(app)/admin/users/page.tsx
 * Purpose: The /admin/users route: lists accounts and lets the admin add and manage them.
 *          Kept thin: loads the accounts and when each was last active, and passes them, with the
 *          server actions, to the feature UI. The header's "Add user" and "Usage" come from
 *          src/features/shell (pageTitles.ts → AddUserButton).
 * Used by: Next.js App Router (admins only, see ../layout.tsx)
 * Depends on: src/server/guard.ts, src/server/users.ts, src/features/admin/UsersPage.tsx, ./actions.ts,
 *             src/ui/PageShell.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2
 */
import { headers } from 'next/headers';
import { UsersPage } from '@/features/admin/UsersPage';
import type { UserRow } from '@/features/admin/types';
import { requireAdmin } from '@/server/guard';
import { lastActiveByUser, listUserAccounts } from '@/server/users';
import { PageShell } from '@/ui/PageShell';
import {
  createUserAction,
  resetPasswordAction,
  setRoleAction,
  toggleDisabledAction,
} from './actions';

/**
 * Admin users page.
 *
 * @returns The users list with its toolbar, actions and dialogs.
 */
export default async function AdminUsersPage() {
  // The layout already checked; this call is cached per request and gives us the admin's id.
  const session = await requireAdmin();
  const [accounts, lastActive] = await Promise.all([
    listUserAccounts(await headers()),
    lastActiveByUser(),
  ]);
  const users: UserRow[] = accounts.map((account) => ({
    ...account,
    lastActiveAt: lastActive.get(account.id) ?? null,
  }));

  return (
    <PageShell title="Users" width="lg">
      <UsersPage
        users={users}
        currentUserId={session.user.id}
        actions={{
          createUser: createUserAction,
          resetPassword: resetPasswordAction,
          setDisabled: toggleDisabledAction,
          setRole: setRoleAction,
        }}
      />
    </PageShell>
  );
}
