/**
 * Tests for apps/web/src/server/jsonPrefix.ts (ADR-0121): readJsonPrefix() reads a whole JSON document as
 * JSON.parse does; for a document cut short it keeps every complete value and drops the one being written
 * (a cut string, number or literal, and any array element that is not complete), while an object member's
 * array or object keeps its complete part; text that is not JSON gives undefined.
 */
import { describe, expect, it } from 'vitest';
import { readJsonPrefix } from '@/server/jsonPrefix';

/** A notes reply in the schema's order (invented). */
const WHOLE = JSON.stringify({
  summary: ['Renewal agreed for 128 seats.', 'Price per seat confirmed: "6,656" a month.'],
  questions: [
    { question: 'Can we pay yearly?', at: 120, answered: 'yes', answerId: 'A1' },
    { question: 'Is SSO included?', at: 300, answered: 'no', answerId: null },
  ],
  nextSteps: [{ step: 'Send the contract', owner: 'You' }],
  unclear: [],
  lessons: [],
});

describe('readJsonPrefix', () => {
  it('reads a whole document like JSON.parse', () => {
    expect(readJsonPrefix(WHOLE)).toEqual(JSON.parse(WHOLE));
    expect(readJsonPrefix('{"a":[1,2.5,-3e2,true,false,null,"x\\n\\u00e9"]}')).toEqual({
      a: [1, 2.5, -300, true, false, null, 'x\né'],
    });
  });

  it('keeps only the complete part at every possible cut of a notes reply', () => {
    for (let cut = 0; cut < WHOLE.length; cut += 1) {
      const value = readJsonPrefix(WHOLE.slice(0, cut)) as Record<string, unknown> | undefined;
      if (value === undefined) {
        // Only before the first character of the object.
        expect(cut).toBe(0);
        continue;
      }
      // Every kept summary bullet is a whole bullet, every kept question a whole question.
      const whole = JSON.parse(WHOLE) as Record<string, unknown[]>;
      for (const [key, items] of Object.entries(value)) {
        expect(Array.isArray(items)).toBe(true);
        for (const [index, item] of (items as unknown[]).entries()) {
          expect(item).toEqual(whole[key]![index]);
        }
      }
    }
  });

  it('drops a string cut mid-way, including one ending on an escape', () => {
    expect(readJsonPrefix('{"summary":["one","tw')).toEqual({ summary: ['one'] });
    expect(readJsonPrefix('{"summary":["one","a \\')).toEqual({ summary: ['one'] });
    expect(readJsonPrefix('{"summary":["one"')).toEqual({ summary: ['one'] });
  });

  it('drops an array element object that is not complete', () => {
    expect(
      readJsonPrefix(
        '{"questions":[{"question":"Q1","at":1,"answered":"yes","answerId":null},{"question":"Q2","at":3',
      ),
    ).toEqual({ questions: [{ question: 'Q1', at: 1, answered: 'yes', answerId: null }] });
  });

  it('drops a number or literal at the very end (more characters may have come)', () => {
    expect(readJsonPrefix('{"a":1,"b":12')).toEqual({ a: 1 });
    expect(readJsonPrefix('{"a":tr')).toEqual({});
  });

  it('gives an empty object when the cut is inside the first key, and undefined for no text', () => {
    expect(readJsonPrefix('{"summ')).toEqual({});
    expect(readJsonPrefix('')).toBeUndefined();
  });

  it('gives undefined for text that is not the start of JSON', () => {
    expect(readJsonPrefix('Here are the notes: {')).toBeUndefined();
    expect(readJsonPrefix('{"a" 1}')).toBeUndefined();
  });
});
