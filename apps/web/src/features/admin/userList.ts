/**
 * File: apps/web/src/features/admin/userList.ts
 * Purpose: The rules behind the Admin → Users page, without React: searching and filtering the list,
 *          the count line, dates, which row actions an admin may take (no changing your own account, and
 *          the last active admin can't be demoted or disabled), the rows of each ⋯ menu, what each
 *          confirmation says, and the toast after an action. Kept pure so they are unit-tested.
 * Used by: src/features/admin/UsersPage.tsx, UsersTable.tsx, UserActionsMenu.tsx;
 *          tests/unit/features/admin/userList.test.ts
 * Depends on: ./types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2;
 *               docs/design/paramount-ai-ui-spec.md §1, S17
 */
import type { Role, UserRow } from './types';

/** The Role filter: everyone, or one role. */
export type RoleFilter = 'all' | Role;

/** The Status filter: everyone, enabled accounts, or disabled ones. */
export type StatusFilter = 'all' | 'active' | 'disabled';

/** What the toolbar asks for. */
export interface UserFilters {
  /** Search text, matched against the name and the email (any case). */
  query: string;
  /** The Role filter. */
  role: RoleFilter;
  /** The Status filter. */
  status: StatusFilter;
}

/** The filters when the page opens: everyone. */
export const NO_FILTERS: UserFilters = { query: '', role: 'all', status: 'all' };

/** The Role filter's choices, in display order. */
export const ROLE_FILTER_OPTIONS: readonly { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All roles' },
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
];

/** The Status filter's choices, in display order. */
export const STATUS_FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
];

/**
 * The accounts that match the toolbar.
 *
 * @param users   Every account.
 * @param filters The search text and the two filters.
 * @returns The matching accounts, in the same order.
 * Called from: UsersPage.tsx; tests
 */
export function filterUsers(users: readonly UserRow[], filters: UserFilters): UserRow[] {
  const query = filters.query.trim().toLowerCase();
  return users.filter((user) => {
    if (filters.role !== 'all' && user.role !== filters.role) return false;
    if (filters.status === 'active' && user.disabled) return false;
    if (filters.status === 'disabled' && !user.disabled) return false;
    if (!query) return true;
    return user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
  });
}

/**
 * Whether any filter or search text is set.
 *
 * @param filters The toolbar's state.
 * @returns True when the list may be showing fewer accounts than exist.
 * Called from: UsersPage.tsx (Clear filters); countLabel(); tests
 */
export function isFiltered(filters: UserFilters): boolean {
  return filters.query.trim() !== '' || filters.role !== 'all' || filters.status !== 'all';
}

/**
 * The count at the end of the toolbar.
 *
 * @param shown How many accounts the list shows.
 * @param total How many exist.
 * @returns "4 users", "1 user", or "2 of 4 users" when filtered.
 * Called from: UsersPage.tsx; tests
 */
export function countLabel(shown: number, total: number): string {
  const noun = total === 1 ? 'user' : 'users';
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

/** Month names for formatDay(). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date as one short line, in UTC. A fixed format (not the browser's locale) keeps the server's
 * and the browser's text the same, so React does not warn about a hydration mismatch.
 *
 * @param date The date (a Date, or what a Date was serialised to).
 * @returns For example "12 Nov 2026".
 * Called from: UsersTable.tsx; tests
 */
export function formatDay(date: Date | string): string {
  const day = new Date(date);
  return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

/**
 * Counts the admins who can act: role admin and not disabled.
 *
 * @param users Every account.
 * @returns The number of active admins.
 * Called from: UsersPage.tsx; guardsFor(); tests
 */
export function activeAdminCount(users: readonly UserRow[]): number {
  return users.filter((user) => user.role === 'admin' && !user.disabled).length;
}

/** Whether an action is allowed on a row, and if not, why. */
export interface Guard {
  /** True when the admin may take the action. */
  allowed: boolean;
  /** Why not, in two or three words for the menu row (only when not allowed). */
  reason?: string;
}

/** The three row actions' guards. */
export interface RowGuards {
  /** Reset password. */
  resetPassword: Guard;
  /** Make admin / Make user. */
  role: Guard;
  /** Disable / Enable. */
  disabled: Guard;
}

/** Shown on rows that are the signed-in admin's own account. */
export const OWN_ACCOUNT_REASON = 'Your account';

/** Shown when the action would leave no active admin. */
export const LAST_ADMIN_REASON = 'Last active admin';

/** An allowed action. */
const ALLOWED: Guard = { allowed: true };

/**
 * Which actions the signed-in admin may take on a row. The server refuses any change to the caller's
 * own account (actions.ts checkTarget); the page also keeps one active admin, so nobody can lock the
 * team out of the Admin pages.
 *
 * @param user          The row.
 * @param currentUserId The signed-in admin's id.
 * @param activeAdmins  activeAdminCount() of every account.
 * @returns The guard for each action.
 * Called from: menuFor(), UsersPage.tsx (checked again before an action runs); tests
 */
export function guardsFor(user: UserRow, currentUserId: string, activeAdmins: number): RowGuards {
  if (user.id === currentUserId) {
    const own: Guard = { allowed: false, reason: OWN_ACCOUNT_REASON };
    return { resetPassword: own, role: own, disabled: own };
  }
  // Demoting or disabling this account would leave the team with no active admin.
  const lastAdmin = user.role === 'admin' && !user.disabled && activeAdmins <= 1;
  const keepAdmin: Guard = lastAdmin ? { allowed: false, reason: LAST_ADMIN_REASON } : ALLOWED;
  return {
    resetPassword: ALLOWED,
    role: user.role === 'admin' ? keepAdmin : ALLOWED,
    // Enabling never removes an admin.
    disabled: user.disabled ? ALLOWED : keepAdmin,
  };
}

/** A change an admin can make from a row's ⋯ menu. */
export type UserAction = 'resetPassword' | 'makeAdmin' | 'makeUser' | 'disable' | 'enable';

/** One row of a user's ⋯ menu. */
export interface UserMenuRow {
  /** What the row does. */
  action: UserAction;
  /** The words on it. */
  label: string;
  /** True when the guard does not allow it (the row is greyed out). */
  disabled: boolean;
  /** Why it is greyed out, shown muted at the end of the row. */
  detail?: string;
  /** True for Disable (red words). */
  danger: boolean;
}

/**
 * The rows of a user's ⋯ menu: Reset password, Make admin or Make user, Disable or Enable.
 *
 * @param user   The row.
 * @param guards guardsFor() of the row.
 * @returns The three menu rows.
 * Called from: UserActionsMenu.tsx; tests
 */
export function menuFor(user: UserRow, guards: RowGuards): UserMenuRow[] {
  /**
   * One row from its guard.
   *
   * @param action The action.
   * @param label  Its words.
   * @param guard  Its guard.
   * @param danger True for red words.
   * @returns The row.
   */
  const row = (action: UserAction, label: string, guard: Guard, danger = false): UserMenuRow => ({
    action,
    label,
    disabled: !guard.allowed,
    ...(guard.reason ? { detail: guard.reason } : {}),
    danger,
  });
  return [
    row('resetPassword', 'Reset password', guards.resetPassword),
    user.role === 'admin'
      ? row('makeUser', 'Make user', guards.role)
      : row('makeAdmin', 'Make admin', guards.role),
    user.disabled
      ? row('enable', 'Enable', guards.disabled)
      : row('disable', 'Disable', guards.disabled, true),
  ];
}

/**
 * Whether an action is allowed, from the row's guards.
 *
 * @param action The action.
 * @param guards guardsFor() of the row.
 * @returns The guard that decides it.
 * Called from: UsersPage.tsx (before running an action); tests
 */
export function guardFor(action: UserAction, guards: RowGuards): Guard {
  if (action === 'resetPassword') return guards.resetPassword;
  if (action === 'makeAdmin' || action === 'makeUser') return guards.role;
  return guards.disabled;
}

/** What a confirmation dialog says. */
export interface Confirmation {
  /** The dialog's title. */
  title: string;
  /** What will happen, in one or two sentences. */
  body: string;
  /** The confirm button's words. */
  confirmLabel: string;
  /** True for a red confirm button (Disable). */
  danger: boolean;
}

/**
 * The confirmation an action needs before it runs. Enable needs none: it only gives access back.
 *
 * @param action The action.
 * @param user   The row.
 * @returns The dialog's words, or null when the action runs at once.
 * Called from: UsersPage.tsx; tests
 */
export function confirmationFor(action: UserAction, user: UserRow): Confirmation | null {
  const name = user.name.trim() || user.email;
  switch (action) {
    case 'resetPassword':
      return {
        title: `Reset ${name}’s password?`,
        body: `${name} gets a new temporary password and is signed out on every device. You’ll see the password once, to pass on yourself; they must change it at their next sign-in.`,
        confirmLabel: 'Reset password',
        danger: false,
      };
    case 'makeAdmin':
      return {
        title: `Make ${name} an admin?`,
        body: `${name} will be able to add users, reset passwords, change roles, disable accounts and see Usage.`,
        confirmLabel: 'Make admin',
        danger: false,
      };
    case 'makeUser':
      return {
        title: `Make ${name} a user?`,
        body: `${name} will lose access to the Admin pages. Their sessions and data are not affected.`,
        confirmLabel: 'Make user',
        danger: false,
      };
    case 'disable':
      return {
        title: `Disable ${name}?`,
        body: `${name} is signed out on every device and can’t sign in until an admin enables the account again. Nothing of theirs is deleted.`,
        confirmLabel: 'Disable',
        danger: true,
      };
    case 'enable':
      return null;
  }
}

/**
 * The toast after an action worked.
 *
 * @param action The action.
 * @param user   The row.
 * @returns For example "Dana Okafor is now an admin".
 * Called from: UsersPage.tsx; tests
 */
export function successMessage(action: UserAction, user: UserRow): string {
  const name = user.name.trim() || user.email;
  switch (action) {
    case 'resetPassword':
      return `Password reset for ${name}`;
    case 'makeAdmin':
      return `${name} is now an admin`;
    case 'makeUser':
      return `${name} is now a user`;
    case 'disable':
      return `${name} is disabled`;
    case 'enable':
      return `${name} is enabled`;
  }
}
