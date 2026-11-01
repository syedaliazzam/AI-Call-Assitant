/**
 * File: apps/web/src/features/live/AudioMeter.tsx
 * Purpose: A small level bar for one call channel ("You" or "Them"), so the user can see that
 *          Kite hears each side before and during the call.
 * Used by: src/features/live/ConnectPanel.tsx, src/features/live/LivePage.tsx (live view header)
 * Depends on: src/features/live/speakers.ts (colours)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect: audio test meters)
 */
import { SPEAKER_STYLE } from './speakers';
import type { Speaker } from '@/core/transcript/transcript';

/** Props for AudioMeter. */
export interface AudioMeterProps {
  /** Which channel. */
  speaker: Speaker;
  /** Current level, 0…1 (from core/audio/capture.ts). */
  level: number;
  /** True while the channel is not capturing (the bar is greyed out). */
  inactive?: boolean;
  /** Narrow version for the live view header. */
  compact?: boolean;
}

/**
 * One channel's level bar with its label.
 *
 * @param props See AudioMeterProps.
 * @returns The meter.
 * Rendered by: LivePage.tsx (one per channel)
 */
export function AudioMeter({ speaker, level, inactive = false, compact = false }: AudioMeterProps) {
  const style = SPEAKER_STYLE[speaker];
  const percent = inactive ? 0 : Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div className={`flex items-center gap-2 ${compact ? 'w-40' : 'w-full'}`}>
      <span className={`w-12 shrink-0 text-sm font-semibold ${style.label}`}>{style.name}</span>
      <div
        className="h-2 flex-1 overflow-hidden bg-ui-band"
        role="meter"
        aria-label={`${style.name} audio level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        {/* No transition: the level already arrives smoothed (levels.ts) about 20 times a second. */}
        <div
          className={`h-full ${inactive ? 'bg-ui-border' : style.bar}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
