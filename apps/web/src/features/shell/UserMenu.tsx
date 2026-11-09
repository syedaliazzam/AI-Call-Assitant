/**
 * File: apps/web/src/features/shell/UserMenu.tsx
 * Purpose: The sidebar's footer (spec S2): an avatar with initials, the name and email, and the ⋮ menu:
 *          Profile, Theme ›, Settings, Admin and Dev Tools (admins only), Tutorials and Feedback ("Soon"),
 *          Open desktop app (in the browser) and Log out.
 * Used by: src/features/shell/AppShell.tsx
 * Depends on: @kite/shared (the link), next/navigation, lucide-react, src/core/auth/authClient.ts,
 *             src/core/storage/appearancePrefs.ts, src/ui/Menu.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2), §5
 */
'use client';

import { DESKTOP_OPEN_LINK } from '@kite/shared';
import {
  CodeXml,
  EllipsisVertical,
  LogOut,
  MessageCircleHeart,
  MonitorUp,
  Settings,
  Shield,
  Sun,
  User,
  Video,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { signOut } from '@/core/auth/authClient';
import {
  getTheme,
  setTheme,
  subscribeAppearance,
  THEME_DEFAULTS,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';
import { getPlatform } from '@/platform';
import { Menu, type MenuEntry } from '@/ui/Menu';

/** The signed-in user, as far as the menu needs to know. */
export interface ShellUser {
  /** Display name. */
  name: string;
  /** Sign-in email. */
  email: string;
  /** 'admin' users also see Admin and Dev Tools. */
  role: 'admin' | 'user';
}

/** Props for UserMenu. */
export interface UserMenuProps {
  /** The signed-in user. */
  user: ShellUser;
  /** True when the sidebar shows icons only: the avatar opens the menu. */
  collapsed: boolean;
}

/** The menu's icons. */
const ICON = { size: 18, strokeWidth: 1.75 } as const;

/** The theme choices' words. */
const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/**
 * Up to two initials for the avatar.
 *
 * @param name The display name.
 * @returns For example "ZU"; "?" for an empty name.
 * Called from: UserMenu; tests
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/**
 * Nothing to subscribe to: the platform does not change while a page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Whether this is a browser, where the desktop app is somewhere else.
 *
 * @returns True in a browser.
 * Called from: UserMenu
 */
const inBrowser = () => getPlatform().offersPlatformChoice;

/**
 * The footer.
 *
 * @param props See UserMenuProps.
 * @returns The avatar, the names and the menu.
 * Rendered by: AppShell.tsx
 */
export function UserMenu({ user, collapsed }: UserMenuProps) {
  const router = useRouter();
  // The dashboard's theme (v1.3.0: light until chosen; the call view has its own).
  const theme = useSyncExternalStore<ThemeChoice>(
    subscribeAppearance,
    () => getTheme('dashboard'),
    () => THEME_DEFAULTS.dashboard,
  );
  const browser = useSyncExternalStore(subscribeNever, inBrowser, () => false);
  const admin = user.role === 'admin';

  /** Signs out this device, then shows the sign-in page. */
  async function logOut() {
    await signOut();
    router.replace('/login');
    router.refresh();
  }

  const items: MenuEntry[] = [
    { label: 'Profile', icon: <User {...ICON} />, onSelect: () => router.push('/profile') },
    {
      label: 'Theme',
      icon: <Sun {...ICON} />,
      detail: THEME_LABELS[theme],
      items: (Object.keys(THEME_LABELS) as ThemeChoice[]).map((choice) => ({
        label: THEME_LABELS[choice],
        selected: choice === theme,
        onSelect: () => setTheme(choice, 'dashboard'),
      })),
    },
    { label: 'Settings', icon: <Settings {...ICON} />, onSelect: () => router.push('/settings') },
    ...(admin
      ? [
          {
            label: 'Admin',
            icon: <Shield {...ICON} />,
            onSelect: () => router.push('/admin/users'),
          },
          {
            label: 'Dev Tools',
            icon: <CodeXml {...ICON} />,
            onSelect: () => router.push('/dev'),
          },
        ]
      : []),
    { divider: true },
    { label: 'Tutorials', icon: <Video {...ICON} />, soon: true },
    { label: 'Feedback', icon: <MessageCircleHeart {...ICON} />, soon: true },
    ...(browser
      ? [
          { divider: true } as const,
          {
            label: 'Open desktop app',
            icon: <MonitorUp {...ICON} />,
            onSelect: () => {
              window.location.href = DESKTOP_OPEN_LINK;
            },
          },
        ]
      : []),
    { divider: true },
    { label: 'Log out', icon: <LogOut {...ICON} />, onSelect: () => void logOut() },
  ];

  const avatar = (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-control bg-ui-subtle text-[13px] font-medium text-ui-heading"
    >
      {initials(user.name)}
    </span>
  );

  // Icons only: the avatar is the menu's button. Below 768 px the drawer is always full width.
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className={collapsed ? 'hidden md:block' : 'hidden'}>
        <Menu
          label={avatar}
          ariaLabel={`Account menu for ${user.name}`}
          variant="plain"
          size="icon"
          placement="top-start"
          buttonClassName="size-10"
          items={items}
        />
      </div>
      <div className={`flex min-w-0 flex-1 items-center gap-2.5 ${collapsed ? 'md:hidden' : ''}`}>
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-ui-heading">{user.name}</p>
          <p className="truncate text-[13px] text-ui-muted">{user.email}</p>
        </div>
        <Menu
          label={<EllipsisVertical aria-hidden="true" size={18} />}
          ariaLabel="Account menu"
          variant="plain"
          size="icon"
          placement="top-end"
          items={items}
        />
      </div>
    </div>
  );
}
