/**
 * Tests apps/web/src/features/help/guideText.ts: the copy of the user guide that /help shows is the same
 * as docs/user-guide/using-kite.md. If this fails, run `pnpm --filter @kite/web make-guide`. Every
 * link in it must be a web address, because /help cannot reach a file in the repository. It carries
 * the Windows warning steps itself, for the same reason.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { linkPieces } from '@/core/answer/markdown';
import { USER_GUIDE_MD } from '@/features/help/guideText';

describe('the guide on /help', () => {
  it('is up to date with the guide in docs', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = path.resolve(here, '../../../../../../docs/user-guide/using-kite.md');
    expect(USER_GUIDE_MD).toBe(readFileSync(source, 'utf8').replace(/\r\n/g, '\n'));
  });

  it('has the steps for the Windows warnings in the guide itself', () => {
    expect(USER_GUIDE_MD).toContain('Windows protected your PC');
    expect(USER_GUIDE_MD).toContain('**More info** → **Run anyway**');
    expect(USER_GUIDE_MD).toContain('If Smart App Control blocks it, use the browser version');
  });

  it('links only to web addresses', () => {
    const written = USER_GUIDE_MD.match(/\[[^\]]+\]\([^)\s]+\)/g) ?? [];
    expect(written.length).toBeGreaterThan(0);
    const links = linkPieces(USER_GUIDE_MD).filter((piece) => piece.href !== null);
    expect(links).toHaveLength(written.length);
  });
});
