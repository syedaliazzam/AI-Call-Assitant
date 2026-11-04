/**
 * File: apps/web/src/features/home/HomeMenu.tsx
 * Purpose: The home panel's ⋮ menu (v1.1.0, ADR-0041): the account, Dashboard ↗, Private (screen-share
 *          protection), Zoom, Theme and Sign out.
 * Used by: src/features/home/HomePanel.tsx
 * Depends on: src/core/auth/authClient.ts, src/core/storage/appearancePrefs.ts,
 *             src/features/privacy/usePrivate.ts, src/platform, src/ui (PanelMenu, icons)
 * Architecture: docs/design/kite-ui-theme.md §5; ADR-0041, ADR-0042
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
import { getPlatform } from '@/platform';
import { GridIcon, PersonIcon, SignOutIcon } from '@/ui/icons';
import { MenuAction, MenuBlock, MenuStepper, MenuSwitch, MenuTheme } from '@/ui/PanelMenu';

/** Props for HomeMenu. */
export interface HomeMenuProps {
  /** The signed-in person's name. */
  name: string;
  /** Their email. */
  email: string;
  /** The theme chosen. */
  theme: ThemeChoice;
  /** The UI scale. */
  zoom: number;
  /** Closes the menu (after an action that leaves it). */
  onClose: () => void;
}

/**
 * The menu.
 *
 * @param props See HomeMenuProps.
 * @returns The menu.
 * Rendered by: HomePanel.tsx
 */
export function HomeMenu({ name, email, theme, zoom, onClose }: HomeMenuProps) {
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
      className="absolute right-2 top-12 z-30 flex max-h-[calc(100vh-3.5rem)] w-72 flex-col gap-1.5 overflow-y-auto rounded-card border border-ui-border bg-ui-surface p-1.5 shadow-modal [-webkit-app-region:no-drag]"
    >
      <p className="flex items-center gap-2 px-2 py-1 text-[13px] text-ui-text">
        <PersonIcon />
        <span className="min-w-0 truncate">
          <span className="font-medium">{name}</span> <span className="text-ui-muted">{email}</span>
        </span>
      </p>
      <MenuBlock>
        <MenuAction
          label="Dashboard"
          icon={<GridIcon />}
          out
          onSelect={() => {
            onClose();
            getPlatform().openPagesWindow('/');
          }}
        />
        <MenuSwitch
          label={PRIVATE_LABEL}
          info={privateHint(protection)}
          checked={protection?.on ?? false}
          disabled={!protection?.supported}
          onChange={changeProtection}
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
        <MenuTheme value={theme} onChange={setTheme} />
        <MenuAction
          label={leaving ? 'Signing out…' : 'Sign out'}
          icon={<SignOutIcon />}
          disabled={leaving}
          onSelect={() => void leave()}
        />
      </MenuBlock>
    </div>
  );
}
