/**
 * File: apps/web/src/features/admin/UserActionsMenu.tsx
 * Purpose: A user's "⋯" menu on the Users page: Reset password, Make admin / Make user, Disable /
 *          Enable. Rows the guards forbid (your own account, the last active admin) are greyed out with
 *          the reason at the end. Choosing a row only asks the page to act: the page confirms first.
 * Used by: src/features/admin/UsersTable.tsx (table rows and phone cards)
 * Depends on: lucide-react, src/ui/Menu.tsx, ./userList.ts, ./types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users);
 *               docs/design/paramount-ai-ui-spec.md §1 (menus), S17
 */
'use client';

import { Ellipsis, KeyRound, ShieldCheck, ShieldOff, UserCheck, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Menu } from '@/ui/Menu';
import type { UserRow } from './types';
import { menuFor, type RowGuards, type UserAction } from './userList';

/** The icon of each row (Lucide, spec §0). */
const ICONS: Record<UserAction, ReactNode> = {
  resetPassword: <KeyRound size={16} strokeWidth={1.75} />,
  makeAdmin: <ShieldCheck size={16} strokeWidth={1.75} />,
  makeUser: <ShieldOff size={16} strokeWidth={1.75} />,
  disable: <UserX size={16} strokeWidth={1.75} />,
  enable: <UserCheck size={16} strokeWidth={1.75} />,
};

/** Props for UserActionsMenu. */
export interface UserActionsMenuProps {
  /** The row. */
  user: UserRow;
  /** guardsFor() of the row. */
  guards: RowGuards;
  /** Called with the chosen action (the page confirms it, then runs it). */
  onAction: (action: UserAction, user: UserRow) => void;
  /** True while another action runs: the button is greyed out. */
  busy: boolean;
}

/**
 * The ⋯ button and its menu.
 *
 * @param props See UserActionsMenuProps.
 * @returns The menu.
 * Rendered by: UsersTable.tsx
 */
export function UserActionsMenu({ user, guards, onAction, busy }: UserActionsMenuProps) {
  const rows = menuFor(user, guards);
  return (
    <Menu
      label={<Ellipsis aria-hidden="true" size={18} strokeWidth={1.75} />}
      ariaLabel={`Actions for ${user.name || user.email}`}
      variant="plain"
      size="icon"
      buttonClassName={busy ? 'pointer-events-none opacity-60' : ''}
      items={rows.map((row) => ({
        label: row.label,
        icon: ICONS[row.action],
        danger: row.danger,
        disabled: row.disabled,
        ...(row.detail ? { detail: row.detail } : {}),
        onSelect: () => onAction(row.action, user),
      }))}
    />
  );
}
