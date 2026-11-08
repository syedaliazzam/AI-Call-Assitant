/**
 * Tests for apps/web/src/core/sync/foreground.ts (ADR-0049): sync is held while any answer streams,
 * overlapping holds all have to end, a release twice counts once, and a waiter is called once no
 * answer streams (at once when none does).
 */
import { describe, expect, it, vi } from 'vitest';
import { answerStreaming, holdSyncForAnswer, whenNoAnswerStreams } from '@/core/sync/foreground';

describe('holding sync for answers', () => {
  it('waits for every overlapping answer, and counts a double release once', () => {
    const waiter = vi.fn();
    const first = holdSyncForAnswer();
    const second = holdSyncForAnswer();
    whenNoAnswerStreams(waiter);
    first();
    first();
    expect(answerStreaming()).toBe(true);
    expect(waiter).not.toHaveBeenCalled();
    second();
    expect(answerStreaming()).toBe(false);
    expect(waiter).toHaveBeenCalledTimes(1);
  });

  it('calls a waiter at once when no answer streams, and a cancelled waiter never', () => {
    const now = vi.fn();
    whenNoAnswerStreams(now);
    expect(now).toHaveBeenCalledTimes(1);
    const release = holdSyncForAnswer();
    const cancelled = vi.fn();
    whenNoAnswerStreams(cancelled)();
    release();
    expect(cancelled).not.toHaveBeenCalled();
  });
});
