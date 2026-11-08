/**
 * Tests for apps/web/src/features/sync/dashboardLink.ts (ADR-0051): links from the address installed
 * desktop apps load go to the custom domain people use; links from any other address (the custom
 * domain itself, a local or preview run) stay on it; a path without a leading slash gets one.
 */
import { describe, expect, it } from 'vitest';
import { DASHBOARD_ORIGIN, DESKTOP_APP_ORIGIN, dashboardUrl } from '@/features/sync/dashboardLink';

describe('dashboardUrl', () => {
  it('sends the desktop app to the custom domain', () => {
    expect(dashboardUrl('/sessions/abc', DESKTOP_APP_ORIGIN)).toBe(
      `${DASHBOARD_ORIGIN}/sessions/abc`,
    );
  });

  it('stays on any other address', () => {
    expect(dashboardUrl('/', DASHBOARD_ORIGIN)).toBe(`${DASHBOARD_ORIGIN}/`);
    expect(dashboardUrl('help', 'http://localhost:3000')).toBe('http://localhost:3000/help');
  });
});
