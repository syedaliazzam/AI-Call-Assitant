/**
 * Tests for apps/desktop/src/icon.ts (UI theme stage U4): appIconPath() points at build/icon.png
 * next to dist/ when the file is there, and returns undefined (Electron's default icon)
 * when it is not; the real build/icon.png exists in the repository.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appIconPath } from '../../src/icon';

describe('appIconPath', () => {
  it('points at build/icon.png beside dist/, or nothing when it is missing', () => {
    const dist = path.join('app', 'dist');
    expect(appIconPath(dist, () => true)).toBe(path.join('app', 'build', 'icon.png'));
    expect(appIconPath(dist, () => false)).toBeUndefined();
  });

  it('finds the real icon made by make-brand', () => {
    expect(appIconPath(path.join(__dirname, '..', '..', 'dist'))).toMatch(/build[\\/]icon\.png$/);
  });
});
