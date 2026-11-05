/**
 * File: apps/web/src/features/live/overlay/DevicePicker.tsx
 * Purpose: The lists under bar 1's two ▾ (spec S13): which microphone to use, and where the other side's
 *          sound comes from. On the desktop the audio source is always the computer's whole sound
 *          (Electron's loopback cannot capture one app), so it is stated, not offered; in a browser,
 *          Change tab on the call's tab picks another source.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/platform (listMicrophones), src/core/live/liveChannel.ts, ./ControlBar.tsx (type)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S13); docs/architecture/kite-architecture-v3.1.md
 *               §3.3, §5; ADR-0041
 */
'use client';

import { forwardRef, useEffect, useState } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import { getPlatform, type MicDevice } from '@/platform';
import type { DeviceList } from './ControlBar';

/** Props for DevicePicker. */
export interface DevicePickerProps {
  /** Which list to show. */
  list: DeviceList;
  /** What the live page shows. */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Closes the list. */
  onClose: () => void;
}

/** The look of the list. */
const LIST =
  'k-overlay-menu absolute top-[calc(100%+6px)] z-30 flex max-h-[calc(100vh-3.75rem)] w-72 flex-col gap-1.5 overflow-y-auto rounded-menu border border-ui-border p-2 text-[13px] text-ui-text shadow-modal [-webkit-app-region:no-drag]';

/**
 * The list.
 *
 * @param props See DevicePickerProps.
 * @param ref   Its element, so the window can grow to fit it.
 * @returns The list.
 * Rendered by: CompactView.tsx
 */
export const DevicePicker = forwardRef<HTMLDivElement, DevicePickerProps>(function DevicePicker(
  { list, state, onCommand, onClose },
  ref,
) {
  const [mics, setMics] = useState<MicDevice[]>([]);
  useEffect(() => {
    if (list !== 'mic') return;
    let active = true;
    getPlatform()
      .listMicrophones()
      .then((found) => {
        if (active) setMics(found);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [list]);
  if (list === 'audio') {
    return (
      <div ref={ref} role="group" aria-label="Audio source" className={`${LIST} left-1.5`}>
        <p className="px-1 text-[12px] font-medium text-ui-muted">Audio source</p>
        <p className="px-2 pb-1">{state?.themSourceLabel ?? "Your computer's sound"}</p>
      </div>
    );
  }
  const chosen = state?.micDeviceId ?? '';
  const options = [
    { id: '', label: 'System default' },
    ...mics.filter((mic) => mic.id !== 'default'),
  ];
  return (
    <div ref={ref} role="group" aria-label="Microphone" className={`${LIST} left-14`}>
      <p className="px-1 text-[12px] font-medium text-ui-muted">Microphone</p>
      <ul role="listbox" aria-label="Microphone" className="flex flex-col">
        {options.map((mic) => (
          <li key={mic.id || 'default'}>
            <button
              type="button"
              role="option"
              aria-selected={chosen === mic.id}
              onClick={() => {
                onCommand({ type: 'mic', deviceId: mic.id });
                onClose();
              }}
              className={`w-full truncate rounded-control px-2 py-1 text-left hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] ${chosen === mic.id ? 'font-semibold' : ''}`}
            >
              {mic.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
