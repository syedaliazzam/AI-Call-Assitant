/**
 * File: apps/web/src/features/home/HomeMenu.tsx
 * Purpose: The home panel's ⋮ menu (spec S12): the email, Dashboard ↗, Voice profile ("Soon"), Get help ↗,
 *          Private (screen-share protection), Meeting detect ("Soon"), Zoom, Theme and Log out.
 * Used by: src/features/home/HomePanel.tsx
 * Depends on: src/core/auth/authClient.ts, src/core/storage/appearancePrefs.ts,
 *             src/features/privacy/usePrivate.ts, src/platform, src/ui (PanelMenu, icons)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S12); ADR-0041, ADR-0042
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '@/core/auth/authClient';
import {
  clampStep,
  setTheme,
  setZoom,
  ZOOM_RANGE,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';
import { PRIVATE_LABEL, privateHint, usePrivate } from '@/features/privacy/usePrivate';
import { openDashboard } from '@/features/sync/dashboardLink';
import { getPlatform } from '@/platform';
import { LayoutDashboard, LifeBuoy, LogOut, User, Waves } from 'lucide-react';
import { MenuAction, MenuBlock, MenuStepper, MenuSwitch, MenuTheme } from '@/ui/PanelMenu';

/** The rows' icons. */
const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** Props for HomeMenu. */
export interface HomeMenuProps {
  /** The signed-in person's email. */
  email: string;
  /** The theme chosen. */
  theme: ThemeChoice;
  /** The UI scale. */
  zoom: number;
  /** Closes the menu (after an action that leaves it). */
  onClose: () => void;
  /** True in the launcher (ADR-0051): Dashboard and Get help open the web app in the browser. */
  launcher?: boolean;
}

/**
 * The menu.
 *
 * @param props See HomeMenuProps.
 * @returns The menu.
 * Rendered by: HomePanel.tsx
 */
export function HomeMenu({ email, theme, zoom, onClose, launcher = false }: HomeMenuProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const { state: protection, change: changeProtection } = usePrivate();

  /** Signs out on this device. The shell keeps this window on the sign-in page. */
  const leave = async () => {
    setLeaving(true);
    await signOut();
    router.replace('/login');
    router.refresh();
  };

  return (
    <div
      role="group"
      aria-label="Home panel menu"
      data-menu="home"
      className="k-anim-menu absolute right-2 top-12 z-30 flex max-h-[calc(100vh-3.5rem)] w-72 flex-col overflow-y-auto rounded-menu bg-ui-surface shadow-modal [-webkit-app-region:no-drag]"
    >
      <MenuBlock>
        <p className="flex min-h-10 items-center gap-2.5 px-3 text-input text-ui-text">
          <User {...ICON} className="shrink-0" />
          <span className="min-w-0 truncate">{email}</span>
        </p>
        <MenuAction
          label="Dashboard"
          icon={<LayoutDashboard {...ICON} />}
          out
          onSelect={() => {
            onClose();
            if (launcher) openDashboard('/');
            else getPlatform().openPagesWindow('/');
          }}
        />
        <MenuAction label="Voice profile" icon={<Waves {...ICON} />} soon />
        <MenuAction
          label="Get help"
          icon={<LifeBuoy {...ICON} />}
          out
          onSelect={() => {
            onClose();
            if (launcher) openDashboard('/help');
            else getPlatform().openPagesWindow('/help');
          }}
        />
        <MenuSwitch
          label={PRIVATE_LABEL}
          info={privateHint(protection)}
          checked={protection?.on ?? false}
          disabled={!protection?.supported}
          onChange={changeProtection}
        />
        <MenuSwitch
          label="Meeting detect"
          info="Noticing a meeting by itself is on its way."
          soon
          checked={false}
          onChange={() => undefined}
        />
        <MenuStepper
          label="Zoom"
          value={`${Math.round(zoom * 100)}%`}
          canMore={zoom < ZOOM_RANGE.max}
          canLess={zoom > ZOOM_RANGE.min}
          onMore={() => setZoom(clampStep(zoom + ZOOM_RANGE.step, ZOOM_RANGE))}
          onLess={() => setZoom(clampStep(zoom - ZOOM_RANGE.step, ZOOM_RANGE))}
          onReset={() => setZoom(ZOOM_RANGE.default)}
        />
        <MenuTheme value={theme} onChange={(choice) => setTheme(choice, 'dashboard')} />
        <MenuAction
          label={leaving ? 'Logging out…' : 'Log out'}
          icon={<LogOut {...ICON} />}
          danger
          disabled={leaving}
          onSelect={() => void leave()}
        />
      </MenuBlock>
    </div>
  );
}
