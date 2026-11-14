/**
 * File: apps/web/src/features/admin/UsersPage.tsx
 * Purpose: The Admin → Users page's content (spec S17): a toolbar (search by name or email, Role and
 *          Status filters, the count), the accounts (UsersTable), each row's ⋯ actions with a
 *          confirmation for Reset password, role changes and Disable, a toast after each action, the
 *          one-time password after a reset, and the Add user dialog (opened from the header).
 *          The guards (not your own account, not the last active admin) are checked again before an
 *          action runs; the server still checks the caller is an admin and not the target.
 * Used by: app/(app)/admin/users/page.tsx
 * Depends on: ./AddUserDialog.tsx, ./UsersTable.tsx, ./TemporaryPasswordBox.tsx, ./addUserSignal.ts,
 *             ./userList.ts, ./types.ts, src/ui (Button, Dialog, Select, Toast)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2;
 *               docs/design/paramount-ai-ui-spec.md §1, S3 (toolbar), S17
 */
'use client';

import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Select } from '@/ui/Select';
import { Toast, useToast } from '@/ui/Toast';
import { AddUserDialog } from './AddUserDialog';
import { onAddUserRequest } from './addUserSignal';
import { TemporaryPasswordBox } from './TemporaryPasswordBox';
import type { AdminActionResult, AdminUserActions, UserRow } from './types';
import { UsersTable } from './UsersTable';
import {
  activeAdminCount,
  confirmationFor,
  countLabel,
  filterUsers,
  guardFor,
  guardsFor,
  isFiltered,
  NO_FILTERS,
  ROLE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  successMessage,
  type RoleFilter,
  type StatusFilter,
  type UserAction,
  type UserFilters,
} from './userList';

/** Props for UsersPage. */
export interface UsersPageProps {
  /** Every account, newest first. */
  users: UserRow[];
  /** The signed-in admin's id. */
  currentUserId: string;
  /** The server actions (app/(app)/admin/users/actions.ts). */
  actions: AdminUserActions;
}

/** An action waiting for its confirmation. */
interface PendingAction {
  /** What to do. */
  action: UserAction;
  /** To whom. */
  user: UserRow;
}

/**
 * The Users page.
 *
 * @param props See UsersPageProps.
 * @returns The toolbar, the accounts, the dialogs and the toast.
 * Rendered by: app/(app)/admin/users/page.tsx
 */
export function UsersPage({ users, currentUserId, actions }: UsersPageProps) {
  const [filters, setFilters] = useState<UserFilters>(NO_FILTERS);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const shown = useMemo(() => filterUsers(users, filters), [users, filters]);
  const activeAdmins = activeAdminCount(users);

  // The header's "Add user" (outside this component) opens the dialog.
  useEffect(() => onAddUserRequest(() => setAdding(true)), []);

  /**
   * Runs an action on the server, then shows the toast (and the password after a reset).
   * The server action refreshes the list itself (revalidatePath).
   *
   * @param action What to do.
   * @param user   To whom.
   */
  async function run(action: UserAction, user: UserRow) {
    // Checked again here: the list may have changed since the menu was drawn.
    const guard = guardFor(action, guardsFor(user, currentUserId, activeAdmins));
    if (!guard.allowed) {
      setPending(null);
      toast.show(`Not allowed: ${guard.reason ?? 'this account'}.`, 'danger');
      return;
    }
    setBusy(true);
    let result: AdminActionResult;
    try {
      if (action === 'resetPassword') result = await actions.resetPassword(user.id);
      else if (action === 'makeAdmin') result = await actions.setRole(user.id, 'admin');
      else if (action === 'makeUser') result = await actions.setRole(user.id, 'user');
      else result = await actions.setDisabled(user.id, action === 'disable');
    } catch {
      // A network failure or an expired page: the action never answered.
      result = { ok: false, error: 'Something went wrong. Please try again.' };
    } finally {
      setBusy(false);
      setPending(null);
    }
    if (!result.ok) {
      toast.show(result.error, 'danger');
      return;
    }
    toast.show(successMessage(action, user), 'success');
    if (result.temporaryPassword) {
      setRevealed({ email: user.email, password: result.temporaryPassword });
    }
  }

  /**
   * A row's menu choice: confirm first when the action needs it, else run it.
   *
   * @param action What was chosen.
   * @param user   On which row.
   */
  function choose(action: UserAction, user: UserRow) {
    if (confirmationFor(action, user)) setPending({ action, user });
    else void run(action, user);
  }

  const confirmation = pending ? confirmationFor(pending.action, pending.user) : null;

  // Stable (show never changes), so the dialog's "created" effect runs once per account.
  const { show } = toast;
  const onCreated = useCallback(
    (email: string) => show(`Account created for ${email}`, 'success'),
    [show],
  );

  return (
    <section aria-label="Users" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex h-10 min-w-0 flex-[1_1_16rem] items-center rounded-control border border-ui-border bg-ui-input shadow-raised focus-within:border-ui-link focus-within:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 sm:max-w-sm">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute left-2.5 text-ui-muted"
          />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Search by name or email"
            aria-label="Search users"
            className="h-full min-w-0 flex-1 bg-transparent pl-8 pr-2 text-base text-ui-text placeholder:text-ui-muted focus:outline-none pointer-coarse:min-h-11 md:text-[14px]"
          />
        </div>
        <div className="flex min-w-0 flex-[1_1_100%] gap-2 sm:flex-none">
          <div className="min-w-0 flex-1 sm:w-36 sm:flex-none">
            <Select<RoleFilter>
              label="Role"
              hideLabel
              options={ROLE_FILTER_OPTIONS}
              value={filters.role}
              onChange={(role) => setFilters({ ...filters, role })}
            />
          </div>
          <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
            <Select<StatusFilter>
              label="Status"
              hideLabel
              options={STATUS_FILTER_OPTIONS}
              value={filters.status}
              onChange={(status) => setFilters({ ...filters, status })}
            />
          </div>
        </div>
        <p
          aria-live="polite"
          className="ml-auto whitespace-nowrap text-[14px] text-ui-muted"
          data-testid="users-count"
        >
          {countLabel(shown.length, users.length)}
        </p>
      </div>

      {shown.length > 0 ? (
        <UsersTable
          users={shown}
          currentUserId={currentUserId}
          activeAdmins={activeAdmins}
          onAction={choose}
          busy={busy}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-ui-border px-4 py-10 text-center">
          <p className="text-[14px] text-ui-muted">
            {isFiltered(filters) ? 'No users match these filters.' : 'No users yet.'}
          </p>
          {isFiltered(filters) && (
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        title={confirmation?.title ?? ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={confirmation?.danger ? 'danger' : 'primary'}
              disabled={busy}
              className="whitespace-nowrap"
              onClick={() => {
                if (pending) void run(pending.action, pending.user);
              }}
            >
              {busy ? 'Working…' : confirmation?.confirmLabel}
            </Button>
          </>
        }
      >
        <p>{confirmation?.body}</p>
      </Dialog>

      <Dialog
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        title="New temporary password"
        footer={<Button onClick={() => setRevealed(null)}>Done</Button>}
      >
        {revealed && <TemporaryPasswordBox email={revealed.email} password={revealed.password} />}
      </Dialog>

      <AddUserDialog
        open={adding}
        onClose={() => setAdding(false)}
        action={actions.createUser}
        onCreated={onCreated}
      />

      <Toast message={toast.current} />
    </section>
  );
}
