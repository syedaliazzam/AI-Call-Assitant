/**
 * File: apps/web/src/features/admin/UsersTable.tsx
 * Purpose: The accounts on the Users page (spec S17): a table from 1024 px (avatar with initials, the
 *          name with a "You" tag on your own row and the email under it, a Role badge, a Status badge,
 *          Created, Last active and a "⋯" menu), and cards below 1024 px with the same facts. Cells
 *          never wrap: long names and emails are cut with "…" and shown whole on hover.
 * Used by: src/features/admin/UsersPage.tsx
 * Depends on: src/features/shell/UserMenu.tsx (initials), ./UserActionsMenu.tsx, ./userList.ts,
 *             ./types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users);
 *               docs/design/paramount-ai-ui-spec.md §1, S17
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { initials } from '@/features/shell/UserMenu';
import type { UserRow } from './types';
import { UserActionsMenu } from './UserActionsMenu';
import { formatDay, guardsFor, type UserAction } from './userList';

/** Props for UsersTable. */
export interface UsersTableProps {
  /** The accounts to show (already searched and filtered). */
  users: readonly UserRow[];
  /** The signed-in admin's id: their row gets "You", and its actions are greyed out. */
  currentUserId: string;
  /** activeAdminCount() of every account (not only the shown ones), for the last-admin guard. */
  activeAdmins: number;
  /** Called with a row's chosen action. */
  onAction: (action: UserAction, user: UserRow) => void;
  /** True while an action runs. */
  busy: boolean;
}

/**
 * The round avatar with up to two initials.
 *
 * @param props.name The display name.
 * @returns The avatar.
 * Rendered by: Identity
 */
function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ui-subtle text-[13px] font-medium text-ui-heading"
    >
      {initials(name)}
    </span>
  );
}

/**
 * The avatar, the name (with "You" on your own row) and the email under it.
 *
 * @param props.user The row.
 * @param props.self True for the signed-in admin's own row.
 * @returns The identity block.
 * Rendered by: the table's first cell and each card
 */
function Identity({ user, self }: { user: UserRow; self: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={user.name} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span title={user.name} className="truncate text-[14px] font-medium text-ui-heading">
            {user.name}
          </span>
          {self && (
            <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-ui-accent-tint px-2 text-chip text-ui-link">
              You
            </span>
          )}
        </div>
        <p title={user.email} className="truncate text-[13px] text-ui-muted">
          {user.email}
        </p>
      </div>
    </div>
  );
}

/**
 * The role as a small pill.
 *
 * @param props.role 'admin' or 'user'.
 * @returns The badge.
 */
function RoleBadge({ role }: { role: UserRow['role'] }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border border-ui-border bg-ui-bg px-2.5 text-chip text-ui-text">
      {role === 'admin' ? 'Admin' : 'User'}
    </span>
  );
}

/**
 * The status as a pill: Active (green) or Disabled (muted). An active account that still has its
 * temporary password says so in its tooltip.
 *
 * @param props.user The row.
 * @returns The badge.
 */
function StatusBadge({ user }: { user: UserRow }) {
  if (user.disabled) {
    return (
      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-ui-subtle px-2.5 text-chip text-ui-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-ui-dot-ended" />
        Disabled
      </span>
    );
  }
  return (
    <span
      title={user.mustChangePassword ? 'Still has the temporary password' : undefined}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-ui-success-bg px-2.5 text-chip text-ui-success"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-ui-dot-success" />
      Active
    </span>
  );
}

/**
 * The Last active words.
 *
 * @param at The last activity, or null.
 * @returns "13 Nov 2026", or "—" when nothing is recorded.
 */
function lastActive(at: Date | null): string {
  return at ? formatDay(at) : '—';
}

/** A header cell's classes. */
const TH = 'whitespace-nowrap px-4 py-3 text-left text-[13px] font-medium text-ui-muted';

/** A body cell's classes. */
const TD = 'whitespace-nowrap px-4 py-3 align-middle';

/**
 * The accounts as a table (from 1024 px) and as cards (below).
 *
 * @param props See UsersTableProps.
 * @returns Both layouts; CSS shows the one that fits.
 * Rendered by: UsersPage.tsx
 */
export function UsersTable({
  users,
  currentUserId,
  activeAdmins,
  onAction,
  busy,
}: UsersTableProps) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-card border border-ui-border bg-ui-surface lg:block">
        <table className="w-full table-fixed text-[14px]">
          <colgroup>
            <col />
            <col className="w-[96px]" />
            <col className="w-[120px]" />
            <col className="w-[128px]" />
            <col className="w-[128px]" />
            <col className="w-[64px]" />
          </colgroup>
          <thead className="border-b border-ui-border bg-ui-band">
            <tr>
              <th scope="col" className={TH}>
                User
              </th>
              <th scope="col" className={TH}>
                Role
              </th>
              <th scope="col" className={TH}>
                Status
              </th>
              <th scope="col" className={TH}>
                Created
              </th>
              <th scope="col" className={TH}>
                Last active
              </th>
              <th scope="col" className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ui-border">
            {users.map((user) => {
              const self = user.id === currentUserId;
              return (
                <tr key={user.id} className="transition-colors hover:bg-ui-hover">
                  <td className={`${TD} max-w-0`}>
                    <Identity user={user} self={self} />
                  </td>
                  <td className={TD}>
                    <RoleBadge role={user.role} />
                  </td>
                  <td className={TD}>
                    <StatusBadge user={user} />
                  </td>
                  <td className={`${TD} text-ui-muted`}>{formatDay(user.createdAt)}</td>
                  <td className={`${TD} text-ui-muted`}>{lastActive(user.lastActiveAt)}</td>
                  <td className={`${TD} text-right`}>
                    <UserActionsMenu
                      user={user}
                      guards={guardsFor(user, currentUserId, activeAdmins)}
                      onAction={onAction}
                      busy={busy}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul aria-label="Users" className="flex flex-col gap-3 lg:hidden">
        {users.map((user) => {
          const self = user.id === currentUserId;
          return (
            <li
              key={user.id}
              className="flex flex-col gap-3 rounded-card border border-ui-border bg-ui-surface p-4"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Identity user={user} self={self} />
                </div>
                <UserActionsMenu
                  user={user}
                  guards={guardsFor(user, currentUserId, activeAdmins)}
                  onAction={onAction}
                  busy={busy}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RoleBadge role={user.role} />
                <StatusBadge user={user} />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <div className="min-w-0">
                  <dt className="text-ui-muted">Created</dt>
                  <dd className="truncate text-ui-text">{formatDay(user.createdAt)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-ui-muted">Last active</dt>
                  <dd className="truncate text-ui-text">{lastActive(user.lastActiveAt)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
