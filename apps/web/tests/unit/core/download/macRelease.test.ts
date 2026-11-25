/**
 * Tests for apps/web/src/core/download/macRelease.ts (ADR-0125): the page asks GET /api/mac-release once and
 * shares the answer; any failure (an error status, a bad body, no network) counts as "not published", so no
 * install is offered. Also apps/web/public/install-mac.sh's ADR-0125 part, read as text (it runs only on a
 * Mac): a 404 from the Mac channel says "Mac version coming soon" and stops before anything is downloaded or
 * installed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetMacReleaseAnswer, macReleasePublished } from '@/core/download/macRelease';

afterEach(() => forgetMacReleaseAnswer());

describe('macReleasePublished (browser, ADR-0125)', () => {
  it('asks the server once per page and shares the answer', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ published: true }));
    expect(await macReleasePublished(fetchImpl)).toBe(true);
    expect(await macReleasePublished(fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/mac-release', { cache: 'no-store' });
  });

  it('counts every failure as not published', async () => {
    expect(await macReleasePublished(async () => Response.json({ published: false }))).toBe(false);
    forgetMacReleaseAnswer();
    expect(await macReleasePublished(async () => new Response('', { status: 401 }))).toBe(false);
    forgetMacReleaseAnswer();
    expect(await macReleasePublished(async () => new Response('<html>', { status: 200 }))).toBe(
      false,
    );
    forgetMacReleaseAnswer();
    expect(
      await macReleasePublished(async () => {
        throw new TypeError('offline');
      }),
    ).toBe(false);
    forgetMacReleaseAnswer();
    expect(await macReleasePublished(async () => Response.json({ published: 'yes' }))).toBe(false);
  });
});

describe('install-mac.sh before the Mac app is published (ADR-0125)', () => {
  const installer = readFileSync(
    path.resolve(import.meta.dirname, '..', '..', '..', '..', 'public', 'install-mac.sh'),
    'utf8',
  );

  it('says "Mac version coming soon" on a 404 from the channel, before any download', () => {
    const notPublished = installer.indexOf('[ "$status" != "404" ]');
    expect(notPublished).toBeGreaterThan(-1);
    expect(installer.slice(notPublished, notPublished + 200)).toContain('Mac version coming soon');
    // The app is downloaded only after that check, and only on a 200.
    expect(installer.indexOf('[ "$status" = "200" ]')).toBeGreaterThan(notPublished);
    expect(installer.indexOf('"$feed/$zip_name"')).toBeGreaterThan(notPublished);
    // The status comes from the channel's own file, over the same protocols as before.
    expect(installer).toMatch(/-w '%\{http_code\}' "\$feed\/latest-mac\.yml"/);
    expect(installer).toContain('--proto "$protocols" --proto-redir "$protocols"');
  });
});
