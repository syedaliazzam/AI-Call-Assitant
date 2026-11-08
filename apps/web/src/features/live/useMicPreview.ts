/**
 * File: apps/web/src/features/live/useMicPreview.ts
 * Purpose: The Connect card's microphone meter (ADR-0053). When the microphone is already allowed
 *          (always so in the desktop app) the meter starts by itself; otherwise the card offers
 *          "Test microphone", whose click makes the browser ask. It restarts on another microphone,
 *          pauses while the card cannot use it, and is stopped by Connect before the call's own
 *          capture opens the microphone.
 * Used by: src/features/live/LivePage.tsx (passes the state to ConnectPanel)
 * Depends on: src/core/audio/micPreview.ts, src/core/audio/capture.ts (CallCaptureError)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect); ADR-0053
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CallCaptureError } from '@/core/audio/capture';
import {
  microphonePermission,
  startMicPreview,
  type MicPermission,
  type MicPreview,
} from '@/core/audio/micPreview';

/** What the Connect card shows for the microphone. */
export interface MicPreviewState {
  /** Whether the microphone is allowed; null while the browser is being asked. */
  permission: MicPermission | null;
  /** The meter level, 0…1, or null when the meter is not running. */
  level: number | null;
  /** Why the microphone could not be opened, for the user (null when fine). */
  error: string | null;
}

/** What useMicPreview() returns. */
export interface MicPreviewControls {
  /** The state for the card. */
  state: MicPreviewState;
  /** "Test microphone": starts the meter (a browser may ask for the microphone first). */
  start: () => void;
  /**
   * Releases the microphone at once. Connect calls this before it opens the call's own capture,
   * so the two never hold the microphone together.
   */
  stop: () => void;
}

/**
 * Runs the Connect card's microphone meter.
 *
 * @param options.deviceId The chosen microphone ('' = the system's default).
 * @param options.enabled  False while the card cannot use the microphone (connecting, in a call).
 * @returns The state and the start / stop controls.
 * Called from: LivePage.tsx
 */
export function useMicPreview(options: { deviceId: string; enabled: boolean }): MicPreviewControls {
  const { deviceId, enabled } = options;
  const [permission, setPermission] = useState<MicPermission | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True once the meter should run: the microphone is already allowed, or the user asked.
  const [wanted, setWanted] = useState(false);
  const running = useRef<MicPreview | null>(null);

  // Asks once whether the microphone is already allowed. Only then does the meter start by itself,
  // so opening the page never makes a browser show its microphone prompt.
  useEffect(() => {
    let active = true;
    void microphonePermission().then((found) => {
      if (!active) return;
      setPermission(found);
      if (found === 'granted') setWanted(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !wanted) return;
    // False once this run is replaced (another microphone, Connect, leaving the page): a late
    // result then releases its microphone instead of showing it.
    let active = true;
    let preview: MicPreview | null = null;
    void startMicPreview({
      deviceId,
      onLevel: (next) => {
        if (active) setLevel(next);
      },
    }).then(
      (started) => {
        if (!active) {
          started.stop();
          return;
        }
        preview = started;
        running.current = started;
        setError(null);
        setPermission('granted');
        setLevel(0);
      },
      (failure: unknown) => {
        if (!active) return;
        setWanted(false);
        setLevel(null);
        setError(
          failure instanceof Error ? failure.message : 'The microphone could not be opened.',
        );
        if (failure instanceof CallCaptureError && failure.code === 'permission-denied') {
          setPermission('denied');
        }
      },
    );
    return () => {
      active = false;
      preview?.stop();
      if (running.current === preview) running.current = null;
      setLevel(null);
    };
  }, [enabled, wanted, deviceId]);

  const start = useCallback(() => {
    setError(null);
    setWanted(true);
  }, []);

  const stop = useCallback(() => {
    running.current?.stop();
    running.current = null;
  }, []);

  return { state: { permission, level, error }, start, stop };
}
