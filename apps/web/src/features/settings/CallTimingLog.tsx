/**
 * File: apps/web/src/features/settings/CallTimingLog.tsx
 * Purpose: Settings → Transcription: download the device-side call timing log (1.5.1, ADR-0069; core/live/
 *          callTimings.ts) for the re-test of the call-latency fixes: the last five calls on this device,
 *          ids and times only, with each call's p50 / p95 summary. Nothing is sent anywhere.
 *          ADR-0076 (investigation T0.1): the "Timing trace" switch (this device only, off by default) adds
 *          each call's timed events to the same log and download.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: React, src/core/live/callTimings.ts, src/ui/Button, src/ui/Toggle
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing); ADR-0069
 */
'use client';

import { useState, useSyncExternalStore } from 'react';
import { callTimings, setTraceEnabled, summarizeCall, traceEnabled } from '@/core/live/callTimings';
import { Button } from '@/ui/Button';
import { Toggle } from '@/ui/Toggle';

/**
 * A subscription that never fires (useSyncExternalStore needs one).
 *
 * @returns A function that unsubscribes nothing.
 */
const subscribeNever = () => () => {};

/**
 * How many calls the log holds.
 *
 * @returns The count.
 */
const savedCount = () => callTimings.saved().length;

/**
 * The download button and a short explanation.
 *
 * @returns The setting.
 * Rendered by: Settings.tsx
 */
export function CallTimingLog() {
  // How many calls are saved: 0 on the server, read from this device in the browser. The log changes
  // only when a call ends, never while Settings is open, so nothing needs to subscribe.
  const count = useSyncExternalStore(subscribeNever, savedCount, () => 0);
  // ADR-0076: the trace switch, read from this device (off on the server render).
  const traceStored = useSyncExternalStore(subscribeNever, traceEnabled, () => false);
  const [traceChoice, setTraceChoice] = useState<boolean | null>(null);
  const trace = traceChoice ?? traceStored;

  /** Hands the saved calls, with their summaries, to the browser as a JSON download. */
  const download = () => {
    const calls = callTimings.saved();
    const file = {
      kind: 'paramount-ai-call-timings',
      // ADR-0076: version 2 adds the trace, the engine per line and the press and request details.
      version: 2,
      exportedAt: Date.now(),
      calls: calls.map((call) => ({ summary: summarizeCall(call), call })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `paramount-ai-call-timings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    // The download has started; the URL is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-ui-muted">
        Call timing log: how quickly lines and answers arrived in your last{' '}
        {count === 1 ? 'call' : `${Math.min(count, 5)} calls`} on this device. Times and ids only,
        never words. For testing call speed with the Paramount AI team.
      </p>
      <Toggle
        label="Timing trace"
        hint="Also records each call's speech, key-press and answer events, with times and counts only (never words), in the same log. This device only. Takes effect from the next call."
        checked={trace}
        onChange={(on) => {
          setTraceEnabled(on);
          setTraceChoice(on);
        }}
      />
      <div>
        <Button size="sm" variant="secondary" onClick={download} disabled={count === 0}>
          Download call timing log
        </Button>
      </div>
    </div>
  );
}
