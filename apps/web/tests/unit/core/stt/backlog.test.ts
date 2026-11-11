/**
 * Tests apps/web/src/core/stt/backlog.ts (1.5.1, ADR-0069): the speech worker's backlog rules. Over 1 s
 * behind, "You" is set aside; over 3 s, the other side's audio is skipped until the backlog is back under
 * 1 s; back under 0.3 s for 5 s, normal again, with the set-aside audio decoded faster than real time.
 * The set-aside store keeps at most 90 s, dropping the oldest.
 */
import { describe, expect, it } from 'vitest';
import {
  BacklogController,
  CATCH_UP_CHUNKS,
  DeferredAudio,
  MAX_DEFERRED_MS,
  RESUME_HOLD_MS,
} from '@/core/stt/backlog';

describe('BacklogController', () => {
  it('stays ok while the worker keeps up', () => {
    const backlog = new BacklogController();
    for (let t = 0; t < 10_000; t += 100) expect(backlog.observe(200, t)).toBe('ok');
    expect(backlog.catchUp(100)).toBe(CATCH_UP_CHUNKS);
  });

  it('sets "You" aside above 1 s, and skips the other side above 3 s until back under 1 s', () => {
    const backlog = new BacklogController();
    expect(backlog.observe(1_200, 0)).toBe('you-paused');
    expect(backlog.catchUp(1_200)).toBe(0);
    expect(backlog.observe(3_500, 100)).toBe('dropping');
    expect(backlog.observe(2_000, 200)).toBe('dropping');
    expect(backlog.observe(900, 300)).toBe('you-paused');
  });

  it('decodes "You" again only after 5 s under 0.3 s, and starts the clock again on any rise', () => {
    const backlog = new BacklogController();
    backlog.observe(1_500, 0);
    expect(backlog.observe(100, 1_000)).toBe('you-paused');
    expect(backlog.observe(500, 3_000)).toBe('you-paused');
    expect(backlog.observe(100, 4_000)).toBe('you-paused');
    expect(backlog.observe(100, 4_000 + RESUME_HOLD_MS - 1)).toBe('you-paused');
    expect(backlog.observe(100, 4_000 + RESUME_HOLD_MS)).toBe('ok');
  });

  it('keeps pace (one set-aside chunk) between 0.3 s and 1 s behind', () => {
    const backlog = new BacklogController();
    expect(backlog.catchUp(600)).toBe(1);
  });
});

describe('DeferredAudio', () => {
  const chunk = (endTime: number) => ({ samples: new Float32Array(1_600), endTime });

  it('gives chunks back oldest first and counts what it holds', () => {
    const store = new DeferredAudio();
    store.push(chunk(1));
    store.push(chunk(2));
    expect(store.length).toBe(2);
    expect(store.ms).toBe(200);
    expect(store.shift()?.endTime).toBe(1);
    expect(store.ms).toBe(100);
    expect(store.shift()?.endTime).toBe(2);
    expect(store.shift()).toBeUndefined();
  });

  it('drops the oldest audio past its limit, and counts it', () => {
    const store = new DeferredAudio(16_000, 300);
    for (let i = 0; i < 5; i += 1) store.push(chunk(i));
    expect(store.ms).toBe(300);
    expect(store.droppedMs).toBe(200);
    expect(store.shift()?.endTime).toBe(2);
  });

  it('keeps 90 s by default', () => {
    expect(MAX_DEFERRED_MS).toBe(90_000);
  });
});
