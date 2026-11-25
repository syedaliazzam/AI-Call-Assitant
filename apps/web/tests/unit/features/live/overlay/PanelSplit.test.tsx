/**
 * Tests for apps/web/src/features/live/overlay/PanelSplit.tsx (ADR-0085): the divider's share at a point
 * (clamped to the split's limits; none for an area with no width), and its markup (a focusable vertical
 * separator with its value, hidden below 600 CSS px of the window, ADR-0119). Also (ADR-0085, Private): no file of the overlay
 * uses a title attribute, whose native tooltip is a separate window that screen-share protection does not
 * cover.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OVERLAY_SPLIT } from '@/core/storage/overlayPrefs';
import { PanelSplit, ratioAt } from '@/features/live/overlay/PanelSplit';

describe('PanelSplit', () => {
  it('ratioAt: the share across the area, within the limits', () => {
    expect(ratioAt(400, 0, 1000)).toBe(0.4);
    expect(ratioAt(150, 100, 1000)).toBe(OVERLAY_SPLIT.min);
    expect(ratioAt(990, 0, 1000)).toBe(OVERLAY_SPLIT.max);
    expect(ratioAt(10, 0, 0)).toBeNull();
  });

  it('is a focusable vertical separator with its value, shown only side by side', () => {
    const html = renderToString(
      <PanelSplit
        ratio={0.4}
        area={{ current: null }}
        onMove={() => undefined}
        onCommit={() => undefined}
        up={false}
      />,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('tabindex="0"');
    // ADR-0119: shown from 600 CSS px of the window (the root container "overlay").
    expect(html).toMatch(/class="[^"]*hidden[^"]*@min-\[600px\]\/overlay:flex/);
    // Not one of the bars, not a gap: see the file's header.
    expect(html).not.toContain('data-bars');
    expect(html).not.toContain('data-gap');
  });
});

describe('the overlay has no title attributes (ADR-0085)', () => {
  it('no file in features/live/overlay, nor CompactView or the Private warning, sets title=', () => {
    const live = path.resolve(__dirname, '../../../../../src/features/live');
    const files = [
      ...readdirSync(path.join(live, 'overlay'))
        .filter((name) => name.endsWith('.tsx'))
        .map((name) => path.join(live, 'overlay', name)),
      path.join(live, 'CompactView.tsx'),
      path.join(live, 'CompactLive.tsx'),
      path.join(live, 'PrivateOffWarning.tsx'),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, path.basename(file)).not.toMatch(/\stitle=\{|\stitle="/);
    }
  });
});
