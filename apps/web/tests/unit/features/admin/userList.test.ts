/**
 * Tests for apps/web/src/features/admin/userList.ts (ADR-0081): the Users page's search and filters,
 * the count, the one-line dates, the guards (your own account; the last active admin cannot be demoted
 * or disabled), the rows of each ⋯ menu, what each confirmation says (none for Enable), and the
 * toast after an action. All names and addresses are invented.
 */
import { describe, expect, it } from 'vitest';
import type { UserRow } from '@/features/admin/types';
import {
  activeAdminCount,
  confirmationFor,
  countLabel,
  filterUsers,
  formatDay,
  guardFor,
  guardsFor,
  isFiltered,
  LAST_ADMIN_REASON,
  menuFor,
  NO_FILTERS,
  OWN_ACCOUNT_REASON,
  successMessage,
} from '@/features/admin/userList';

/**
 * An invented account.
 *
 * @param id   Its id.
 * @param more Fields to change.
 * @returns The row.
 */
function row(id: string, more: Partial<UserRow> = {}): UserRow {
  return {
    id,
    name: `Person ${id}`,
    email: `${id}@example.com`,
    role: 'user',
    disabled: false,
    mustChangePassword: false,
    createdAt: new Date('2026-11-12T10:00:00Z'),
    lastActiveAt: null,
    ...more,
  };
}

const sam = row('sam', { name: 'Sam Lee', role: 'admin' });
const dana = row('dana', { name: 'Dana Okafor', email: 'dana.okafor@example.com' });
const ravi = row('ravi', { name: 'Ravi Menon', disabled: true });
const ana = row('ana', { name: 'Ana Ruiz', role: 'admin' });
const ALL = [sam, dana, ravi, ana];

describe('filterUsers and the count', () => {
  it('searches the name and the email, in any case', () => {
    expect(filterUsers(ALL, { ...NO_FILTERS, query: 'okafor' })).toEqual([dana]);
    expect(filterUsers(ALL, { ...NO_FILTERS, query: '  SAM ' })).toEqual([sam]);
    expect(filterUsers(ALL, { ...NO_FILTERS, query: 'ravi@example' })).toEqual([ravi]);
    expect(filterUsers(ALL, NO_FILTERS)).toEqual(ALL);
  });

  it('filters by role and status, together with the search', () => {
    expect(filterUsers(ALL, { ...NO_FILTERS, role: 'admin' })).toEqual([sam, ana]);
    expect(filterUsers(ALL, { ...NO_FILTERS, role: 'user' })).toEqual([dana, ravi]);
    expect(filterUsers(ALL, { ...NO_FILTERS, status: 'disabled' })).toEqual([ravi]);
    expect(filterUsers(ALL, { ...NO_FILTERS, status: 'active' })).toEqual([sam, dana, ana]);
    expect(filterUsers(ALL, { query: 'a', role: 'user', status: 'active' })).toEqual([dana]);
  });

  it('says how many, and "N of M" while filtered', () => {
    expect(countLabel(4, 4)).toBe('4 users');
    expect(countLabel(1, 1)).toBe('1 user');
    expect(countLabel(2, 4)).toBe('2 of 4 users');
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, query: ' ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, status: 'disabled' })).toBe(true);
  });
});

describe('formatDay', () => {
  it('writes one short line in UTC, from a Date or its serialised form', () => {
    expect(formatDay(new Date('2026-11-12T23:30:00Z'))).toBe('12 Nov 2026');
    expect(formatDay('2026-01-03T00:00:00.000Z')).toBe('3 Jan 2026');
  });
});

describe('guardsFor (no self-lockout, keep one active admin)', () => {
  it('greys out every action on your own row', () => {
    const own = guardsFor(sam, 'sam', 2);
    for (const guard of [own.resetPassword, own.role, own.disabled]) {
      expect(guard).toEqual({ allowed: false, reason: OWN_ACCOUNT_REASON });
    }
  });

  it('allows everything on another account while two admins are active', () => {
    expect(activeAdminCount(ALL)).toBe(2);
    expect(guardsFor(ana, 'sam', 2)).toEqual({
      resetPassword: { allowed: true },
      role: { allowed: true },
      disabled: { allowed: true },
    });
    expect(guardsFor(dana, 'sam', 2).role.allowed).toBe(true);
  });

  it('keeps the last active admin: no demotion, no disabling; a reset is still fine', () => {
    const last = guardsFor(ana, 'someone-else', 1);
    expect(last.role).toEqual({ allowed: false, reason: LAST_ADMIN_REASON });
    expect(last.disabled).toEqual({ allowed: false, reason: LAST_ADMIN_REASON });
    expect(last.resetPassword.allowed).toBe(true);
  });

  it('does not count disabled admins, and lets a disabled admin be enabled or demoted', () => {
    const disabledAdmin = row('old', { role: 'admin', disabled: true });
    expect(activeAdminCount([sam, disabledAdmin])).toBe(1);
    const guards = guardsFor(disabledAdmin, 'sam', 1);
    expect(guards.disabled.allowed).toBe(true);
    expect(guards.role.allowed).toBe(true);
  });

  it('guardFor picks the guard of each action', () => {
    const guards = guardsFor(ana, 'x', 1);
    expect(guardFor('resetPassword', guards).allowed).toBe(true);
    expect(guardFor('makeUser', guards).allowed).toBe(false);
    expect(guardFor('disable', guards).allowed).toBe(false);
  });
});

describe('menuFor (the ⋯ menu)', () => {
  it('lists Reset password, the role switch and Disable for an active user', () => {
    expect(menuFor(dana, guardsFor(dana, 'sam', 2))).toEqual([
      { action: 'resetPassword', label: 'Reset password', disabled: false, danger: false },
      { action: 'makeAdmin', label: 'Make admin', disabled: false, danger: false },
      { action: 'disable', label: 'Disable', disabled: false, danger: true },
    ]);
  });

  it('offers Make user for an admin and Enable for a disabled account', () => {
    expect(menuFor(ana, guardsFor(ana, 'sam', 2)).map((item) => item.label)).toEqual([
      'Reset password',
      'Make user',
      'Disable',
    ]);
    expect(menuFor(ravi, guardsFor(ravi, 'sam', 2))[2]).toEqual({
      action: 'enable',
      label: 'Enable',
      disabled: false,
      danger: false,
    });
  });

  it('greys out rows with the reason at the end', () => {
    const own = menuFor(sam, guardsFor(sam, 'sam', 2));
    expect(own.every((item) => item.disabled && item.detail === OWN_ACCOUNT_REASON)).toBe(true);
    const last = menuFor(ana, guardsFor(ana, 'x', 1));
    expect(last.map((item) => [item.label, item.disabled, item.detail])).toEqual([
      ['Reset password', false, undefined],
      ['Make user', true, LAST_ADMIN_REASON],
      ['Disable', true, LAST_ADMIN_REASON],
    ]);
  });
});

describe('confirmationFor and successMessage', () => {
  it('asks before a reset, a role change and Disable, saying what happens', () => {
    const reset = confirmationFor('resetPassword', dana)!;
    expect(reset.title).toBe('Reset Dana Okafor’s password?');
    expect(reset.body).toContain('signed out on every device');
    expect(reset.body).toContain('temporary password');
    expect(reset.confirmLabel).toBe('Reset password');
    expect(reset.danger).toBe(false);

    expect(confirmationFor('makeAdmin', dana)!.body).toContain('add users, reset passwords');
    expect(confirmationFor('makeUser', ana)!.body).toContain('lose access to the Admin pages');

    const disable = confirmationFor('disable', dana)!;
    expect(disable.title).toBe('Disable Dana Okafor?');
    expect(disable.body).toContain('can’t sign in');
    expect(disable.body).toContain('Nothing of theirs is deleted');
    expect(disable.danger).toBe(true);
  });

  it('runs Enable without asking', () => {
    expect(confirmationFor('enable', ravi)).toBeNull();
  });

  it('uses the email when the name is empty', () => {
    expect(confirmationFor('disable', row('x', { name: ' ' }))!.title).toBe(
      'Disable x@example.com?',
    );
  });

  it('words each toast', () => {
    expect(successMessage('resetPassword', dana)).toBe('Password reset for Dana Okafor');
    expect(successMessage('makeAdmin', dana)).toBe('Dana Okafor is now an admin');
    expect(successMessage('makeUser', ana)).toBe('Ana Ruiz is now a user');
    expect(successMessage('disable', dana)).toBe('Dana Okafor is disabled');
    expect(successMessage('enable', ravi)).toBe('Ravi Menon is enabled');
  });
});
