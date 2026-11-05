/**
 * Tests apps/web/src/features/dashboard/sessionCardParts.ts (spec S3): a regular call's title is its
 * topic, the letter tile is stable and in range, and the usage line says what happened in the call.
 */
import { describe, expect, it } from 'vitest';
import {
  letterTile,
  sessionCardLine,
  sessionCardTitle,
  sessionUsageLine,
  TILE_COLOURS,
} from '@/features/dashboard/sessionCardParts';

describe('the card’s title and line', () => {
  it('shows the company and role for an interview or a mock', () => {
    const session = { type: 'interview', company: 'Lantern', role: 'Analyst' } as const;
    expect(sessionCardTitle(session)).toBe('Lantern');
    expect(sessionCardLine(session)).toBe('Analyst');
  });

  it('shows the title and then the company for a regular call', () => {
    const session = { type: 'regular', company: 'Alder', role: 'Renewal review' } as const;
    expect(sessionCardTitle(session)).toBe('Renewal review');
    expect(sessionCardLine(session)).toBe('Alder');
  });

  it('falls back when a name is missing, without repeating itself', () => {
    expect(sessionCardTitle({ type: 'mock', company: ' ', role: 'Analyst' })).toBe('Mock call');
    const noTopic = { type: 'regular', company: 'Alder', role: '' } as const;
    expect(sessionCardTitle(noTopic)).toBe('Alder');
    expect(sessionCardLine(noTopic)).toBe('');
  });
});

describe('letterTile', () => {
  it('uses the first letter, in capitals', () => {
    expect(letterTile('  lantern').letter).toBe('L');
    expect(letterTile('').letter).toBe('?');
  });

  it('gives a name the same colour every time, ignoring case, and stays in range', () => {
    expect(letterTile('Lantern').colour).toBe(letterTile('lantern').colour);
    const names = ['Lantern', 'Alder', 'Zephyr', 'Northwind', 'Harbor', 'Meta', 'Google', 'Amazon'];
    const colours = names.map((name) => letterTile(name).colour);
    for (const colour of colours) {
      expect(colour).toBeGreaterThanOrEqual(0);
      expect(colour).toBeLessThan(TILE_COLOURS);
    }
    // The names spread across colours rather than all landing on one.
    expect(new Set(colours).size).toBeGreaterThan(2);
  });
});

describe('sessionUsageLine', () => {
  it('says a session has not started', () => {
    expect(sessionUsageLine({ lastActiveAt: null }, 'not-started', 0)).toBe('Not started yet');
  });

  it('gives the call’s length and the answers', () => {
    const ended = { lastActiveAt: 1, lastCallMs: 413_000 };
    expect(sessionUsageLine(ended, 'ended', 12)).toBe('6m 53s · 12 answers');
    expect(sessionUsageLine(ended, 'ended', 1)).toBe('6m 53s · 1 answer');
    expect(sessionUsageLine(ended, 'ended', 0)).toBe('6m 53s');
  });

  it('copes with older sessions that have no length', () => {
    expect(sessionUsageLine({ lastActiveAt: 1 }, 'ended', 3)).toBe('3 answers');
    expect(sessionUsageLine({ lastActiveAt: 1 }, 'ended', 0)).toBe('No answers yet');
    expect(sessionUsageLine({ lastActiveAt: 1 }, 'live', 0)).toBe('Call in progress');
  });
});
