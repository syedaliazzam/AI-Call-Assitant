/**
 * Tests for apps/web/src/server/usage.ts (v1.0.2, ADR-0036), with the database replaced by an
 * in-memory fake: each request is counted per user and UTC day; the request over the limit is
 * refused (and still counted); the limit defaults to 300, is read from app_setting, kept for 60 s,
 * and only whole numbers from 1 to 100,000 can be set; when counting fails the request is allowed
 * (fail open); the usage report gives today and the last 7 days per user, counts only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The fake database's contents and switches. */
const fake = vi.hoisted(() => ({
  /** app_setting rows for the limit. */
  setting: [] as { value: string }[],
  /** usage_day counters by user id + day. */
  counts: new Map<string, number>(),
  /** Accounts, for the report. */
  users: [] as { id: string; name: string; email: string }[],
  /** usage_day rows, for the report. */
  usage: [] as { userId: string; day: string; requests: number }[],
  /** True to make the counting statement fail. */
  fail: false,
  /** How many times app_setting was read. */
  settingReads: 0,
}));

/**
 * The table's name, as drizzle stores it on the table object.
 *
 * @param table A drizzle table.
 * @returns Its SQL name.
 */
function tableName(table: unknown): string {
  return (table as Record<symbol, string>)[Symbol.for('drizzle:Name')]!;
}

vi.mock('server-only', () => ({}));
vi.mock('@/server/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const rows = () => {
          const name = tableName(table);
          if (name === 'app_setting') {
            fake.settingReads += 1;
            return fake.setting;
          }
          return name === 'user' ? fake.users : fake.usage;
        };
        return {
          where: async () => rows(),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows()).then(resolve),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (value: { userId?: string; day?: string; value?: string }) => ({
        onConflictDoUpdate: () => {
          if (tableName(table) === 'app_setting') {
            fake.setting = [{ value: value.value! }];
            return Promise.resolve();
          }
          return {
            returning: async () => {
              if (fake.fail) throw new Error('connection refused');
              const key = `${value.userId}|${value.day}`;
              const next = (fake.counts.get(key) ?? 0) + 1;
              fake.counts.set(key, next);
              return [{ requests: next }];
            },
          };
        },
      }),
    }),
  },
}));

const usage = await import('@/server/usage');

/** A fixed time: 3 Nov 2026, 23:30 UTC. */
const NOW = new Date('2026-11-03T23:30:00Z');

beforeEach(() => {
  fake.setting = [];
  fake.counts.clear();
  fake.users = [];
  fake.usage = [];
  fake.fail = false;
  fake.settingReads = 0;
  usage.resetUsageCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('countRequest', () => {
  it('counts each request per user and UTC day, and allows up to the limit', async () => {
    fake.setting = [{ value: '2' }];
    const first = await usage.countRequest('u1', NOW);
    const second = await usage.countRequest('u1', NOW);
    const third = await usage.countRequest('u1', NOW);
    expect([first.count, second.count, third.count]).toEqual([1, 2, 3]);
    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, false]);
    expect(third.limit).toBe(2);
    // Another user, and the next UTC day, start from zero.
    expect((await usage.countRequest('u2', NOW)).count).toBe(1);
    expect((await usage.countRequest('u1', new Date('2026-11-04T00:00:01Z'))).count).toBe(1);
  });

  it('uses 300 when no limit is stored, and reads the setting once per minute', async () => {
    const result = await usage.countRequest('u1', NOW);
    expect(result.limit).toBe(usage.DEFAULT_DAILY_LIMIT);
    expect(usage.DEFAULT_DAILY_LIMIT).toBe(300);
    await usage.countRequest('u1', new Date(NOW.getTime() + 30_000));
    expect(fake.settingReads).toBe(1);
    await usage.countRequest('u1', new Date(NOW.getTime() + 61_000));
    expect(fake.settingReads).toBe(2);
  });

  it('allows the request when counting fails (fail open), logging no request details', async () => {
    fake.fail = true;
    const result = await usage.countRequest('u1', NOW);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(0);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('"userId":"u1"');
  });
});

describe('daily limit setting', () => {
  it('parses only whole numbers in range, otherwise the default', () => {
    expect(usage.parseDailyLimit('50')).toBe(50);
    expect(usage.parseDailyLimit(undefined)).toBe(300);
    expect(usage.parseDailyLimit('0')).toBe(300);
    expect(usage.parseDailyLimit('2.5')).toBe(300);
    expect(usage.parseDailyLimit('abc')).toBe(300);
    expect(usage.parseDailyLimit('100001')).toBe(300);
  });

  it('stores a valid limit and applies it at once', async () => {
    await usage.setDailyLimit(25);
    expect(fake.setting).toEqual([{ value: '25' }]);
    expect(await usage.getDailyLimit()).toBe(25);
  });

  it('rejects limits that are not whole numbers from 1 to 100,000', async () => {
    for (const bad of [0, -1, 1.5, 100_001, Number.NaN]) {
      await expect(usage.setDailyLimit(bad)).rejects.toThrow('INVALID_LIMIT');
    }
    expect(fake.setting).toEqual([]);
  });
});

describe('usage report', () => {
  it('gives today and the period total per user, most requests first', () => {
    const rows = usage.buildUsageReport(
      [
        { id: 'a', name: 'Ann', email: 'ann@example.com' },
        { id: 'b', name: 'Ben', email: 'ben@example.com' },
        { id: 'c', name: 'Cy', email: 'cy@example.com' },
      ],
      [
        { userId: 'a', day: '2026-11-03', requests: 4 },
        { userId: 'a', day: '2026-11-01', requests: 6 },
        { userId: 'b', day: '2026-11-03', requests: 12 },
      ],
      '2026-11-03',
    );
    expect(rows.map((row) => [row.name, row.today, row.lastDays])).toEqual([
      ['Ben', 12, 12],
      ['Ann', 4, 10],
      ['Cy', 0, 0],
    ]);
  });

  it('reads accounts and counts from the database', async () => {
    fake.users = [{ id: 'a', name: 'Ann', email: 'ann@example.com' }];
    fake.usage = [{ userId: 'a', day: '2026-11-03', requests: 3 }];
    expect(await usage.usageReport(7, NOW)).toEqual([
      { userId: 'a', name: 'Ann', email: 'ann@example.com', today: 3, lastDays: 3 },
    ]);
  });

  it('writes days as UTC dates', () => {
    expect(usage.utcDay(new Date('2026-11-03T23:59:59Z'))).toBe('2026-11-03');
    expect(usage.utcDay(new Date('2026-11-04T00:00:00Z'))).toBe('2026-11-04');
  });
});
