/**
 * Tests apps/web/src/features/shell/AppHeader.tsx and the phone drawer of src/ui/Sidebar.tsx: the Paramount AI
 * logo is a link to Call Sessions (/), in the header and in the drawer, with a name a screen reader can say.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/platform', () => ({ getPlatform: () => ({}), getDesktopInfo: () => null }));

const { AppHeader } = await import('@/features/shell/AppHeader');
const { Sidebar } = await import('@/ui/Sidebar');

/**
 * Whether the markup has the logo link: an <a> to / named "Paramount AI: go to Call Sessions".
 *
 * @param html The rendered markup.
 * @returns True when it is there.
 */
function hasLogoLink(html: string): boolean {
  return (html.match(/<a\b[^>]*>/g) ?? []).some(
    (tag) =>
      tag.includes('href="/"') && tag.includes('aria-label="Paramount AI: go to Call Sessions"'),
  );
}

describe('the Paramount AI logo', () => {
  it('links to Call Sessions in the header, from any page', () => {
    const html = renderToString(
      <AppHeader
        collapsed={false}
        onToggleCollapsed={() => undefined}
        onOpenDrawer={() => undefined}
      />,
    );
    expect(hasLogoLink(html)).toBe(true);
  });

  it('links to Call Sessions in the phone drawer too', () => {
    const html = renderToString(
      <Sidebar collapsed={false} drawerOpen onCloseDrawer={() => undefined} footer={null} />,
    );
    expect(hasLogoLink(html)).toBe(true);
  });
});
