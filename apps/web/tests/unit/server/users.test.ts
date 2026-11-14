/**
 * Tests for apps/web/src/server/users.ts, with Better Auth and the database mocked:
 * accounts are created with a temporary password and mustChangePassword = true, a taken email
 * becomes Error('EMAIL_TAKEN'), a reset sets a new password, re-flags the account and signs the
 * user out, disabling uses ban/unban, markPasswordChanged() clears the flag, and lastActiveByUser()
 * keeps the later of the newest session refresh and the last usage day per account (ADR-0081).
 */
import { APIError } from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Fake Better Auth server API. */
const api = {
  createUser: vi.fn(),
  listUsers: vi.fn(),
  setUserPassword: vi.fn(),
  revokeUserSessions: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  setRole: vi.fn(),
};

/** Fake Drizzle update chain: db.update(table).set(values).where(condition). */
const where = vi.fn();
const set = vi.fn(() => ({ where }));
const update = vi.fn(() => ({ set }));

/** Fake Drizzle select chain: db.select(fields).from(table).groupBy(column) → rows. */
const groupBy = vi.fn();
const select = vi.fn(() => ({ from: () => ({ groupBy }) }));

vi.mock('@/server/auth', () => ({
  auth: { api },
}));
vi.mock('@/server/db', () => ({ db: { update, select } }));

const users = await import('@/server/users');

/** Request headers an admin's call would carry. */
const headers = new Headers({ cookie: 'session=fake' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createUserAccount', () => {
  it('creates the user with a temporary password and mustChangePassword = true', async () => {
    api.createUser.mockResolvedValue({ user: { id: 'u1' } });

    const created = await users.createUserAccount(
      { name: 'Ada', email: 'Ada@Example.com', role: 'user' },
      headers,
    );

    expect(created.id).toBe('u1');
    expect(created.temporaryPassword).toHaveLength(14);
    expect(api.createUser).toHaveBeenCalledWith({
      body: {
        name: 'Ada',
        email: 'ada@example.com',
        password: created.temporaryPassword,
        role: 'user',
        data: { mustChangePassword: true },
      },
      headers,
    });
  });

  it('sends no headers when called from the create-admin script', async () => {
    api.createUser.mockResolvedValue({ user: { id: 'u1' } });
    await users.createUserAccount({ name: 'Ada', email: 'a@b.co', role: 'admin' });
    expect(api.createUser.mock.calls[0]?.[0]).not.toHaveProperty('headers');
  });

  it('turns "user already exists" into Error("EMAIL_TAKEN")', async () => {
    api.createUser.mockRejectedValue(
      new APIError('BAD_REQUEST', { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' }),
    );
    await expect(
      users.createUserAccount({ name: 'Ada', email: 'a@b.co', role: 'user' }, headers),
    ).rejects.toThrow('EMAIL_TAKEN');
  });

  it('passes other errors through unchanged', async () => {
    const error = new APIError('FORBIDDEN', { code: 'YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS' });
    api.createUser.mockRejectedValue(error);
    await expect(
      users.createUserAccount({ name: 'Ada', email: 'a@b.co', role: 'user' }, headers),
    ).rejects.toBe(error);
  });
});

describe('listUserAccounts', () => {
  it('maps Better Auth users to table rows', async () => {
    api.listUsers.mockResolvedValue({
      users: [
        {
          id: 'u1',
          name: 'Ada',
          email: 'ada@example.com',
          role: 'admin',
          banned: false,
          mustChangePassword: false,
          createdAt: '2026-10-26T10:00:00.000Z',
        },
        {
          id: 'u2',
          name: 'Bob',
          email: 'bob@example.com',
          role: null,
          banned: true,
          mustChangePassword: true,
          createdAt: '2026-10-26T11:00:00.000Z',
        },
      ],
    });

    const rows = await users.listUserAccounts(headers);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'u1',
        role: 'admin',
        disabled: false,
        mustChangePassword: false,
      }),
      expect.objectContaining({ id: 'u2', role: 'user', disabled: true, mustChangePassword: true }),
    ]);
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });
});

describe('resetUserPassword', () => {
  it('sets a new temporary password, re-flags the account and signs the user out', async () => {
    const password = await users.resetUserPassword('u2', headers);

    expect(password).toHaveLength(14);
    expect(api.setUserPassword).toHaveBeenCalledWith({
      body: { userId: 'u2', newPassword: password },
      headers,
    });
    expect(set).toHaveBeenCalledWith({ mustChangePassword: true });
    expect(api.revokeUserSessions).toHaveBeenCalledWith({ body: { userId: 'u2' }, headers });
  });
});

describe('setUserDisabled', () => {
  it('bans the user to disable them', async () => {
    await users.setUserDisabled('u2', true, headers);
    expect(api.banUser).toHaveBeenCalledWith({
      body: { userId: 'u2', banReason: 'Disabled by an admin' },
      headers,
    });
    expect(api.unbanUser).not.toHaveBeenCalled();
  });

  it('unbans the user to enable them', async () => {
    await users.setUserDisabled('u2', false, headers);
    expect(api.unbanUser).toHaveBeenCalledWith({ body: { userId: 'u2' }, headers });
  });
});

describe('setUserRole', () => {
  it('sets the role through Better Auth', async () => {
    await users.setUserRole('u2', 'admin', headers);
    expect(api.setRole).toHaveBeenCalledWith({ body: { userId: 'u2', role: 'admin' }, headers });
  });
});

describe('markPasswordChanged', () => {
  it('clears mustChangePassword for that user', async () => {
    await users.markPasswordChanged('u1');
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ mustChangePassword: false });
    expect(where).toHaveBeenCalledTimes(1);
  });
});

describe('lastActiveByUser', () => {
  it('keeps the later of the newest session refresh and the last usage day, per account', async () => {
    // Promise.all starts the session query first, then the usage query.
    groupBy
      .mockResolvedValueOnce([
        { userId: 'u1', at: new Date('2026-11-13T09:15:00Z') },
        { userId: 'u2', at: new Date('2026-11-01T08:00:00Z') },
        { userId: 'u4', at: null },
      ])
      .mockResolvedValueOnce([
        { userId: 'u1', day: '2026-11-12' },
        { userId: 'u2', day: '2026-11-14' },
        { userId: 'u3', day: '2026-10-30' },
      ]);
    const latest = await users.lastActiveByUser();
    expect(select).toHaveBeenCalledTimes(2);
    expect(latest.get('u1')).toEqual(new Date('2026-11-13T09:15:00Z'));
    expect(latest.get('u2')).toEqual(new Date('2026-11-14T00:00:00Z'));
    expect(latest.get('u3')).toEqual(new Date('2026-10-30T00:00:00Z'));
    expect(latest.has('u4')).toBe(false);
  });
});
