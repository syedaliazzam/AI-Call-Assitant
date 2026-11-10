/**
 * File: apps/web/src/features/live/CompactLive.tsx
 * Purpose: The overlay's live side: connects CompactView to the live page of the same session over
 *          the session channel, applies its opacity and fade through the platform, sizes the window to
 *          the open panels (v1.1.0), and handles the shortcuts while the overlay itself has focus. In
 *          the desktop overlay window and in the browser's picture-in-picture window.
 * Used by: app/compact/[id]/page.tsx (desktop overlay window),
 *          src/features/live/LiveAnswers.tsx (browser picture-in-picture)
 * Depends on: src/core/live/liveChannel.ts, src/core/storage/overlayPrefs.ts,
 *             src/features/appearance/useAppearance.ts, src/features/privacy/usePrivate.ts, src/platform,
 *             src/features/live/CompactView.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §7.1; ADR-0029, ADR-0041
 */
'use client';

import type { OverlayLayout, OverlayPreset, OverlayResizeStep } from '@kite/shared';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { authClient } from '@/core/auth/authClient';
import { isDoublePress } from '@/core/live/doublePress';
import {
  openLiveChannel,
  type CompactLevels,
  type CompactState,
  type LiveChannel,
} from '@/core/live/liveChannel';
import {
  getOverlayFade,
  getOverlayOpacity,
  getOverlayPanels,
  paintedOpacity,
  setOverlayOpacityPref,
  setOverlayPanels,
  type OverlayPanels,
} from '@/core/storage/overlayPrefs';
import { useAppearance } from '@/features/appearance/useAppearance';
import { usePrivate } from '@/features/privacy/usePrivate';
import { getPlatform } from '@/platform';
import { CompactView } from './CompactView';
import type { ChatBarHandle } from './overlay/ChatBar';
import { openDashboard } from '@/features/sync/dashboardLink';
import { useSyncAccount } from '@/features/sync/SyncScope';
import type { LevelStore } from './overlay/parts';

/** Props for CompactLive. */
export interface CompactLiveProps {
  /** The live session's id (from the URL). */
  sessionId: string;
  /**
   * Close the window when the call ends (default true: the desktop overlay window). Inside a
   * browser picture-in-picture window, 'window' is the main page, so the platform closes it.
   */
  closeOnEnd?: boolean;
  /** The signed-in person's email, when the route knows it; otherwise it is asked for once. */
  email?: string;
}

/**
 * Nothing to subscribe to: the OS does not change during a page's life.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Whether the shortcuts use ⌘ (macOS). Server render: not a Mac.
 *
 * @returns True on macOS.
 */
const isMac = () => getPlatform().hotkeyModifier() === '⌘';

/**
 * Creates the store the level bars read, so the levels redraw only them.
 *
 * @returns The store, and how to give it new levels.
 * Called from: CompactLive
 */
function createLevelStore(): LevelStore & {
  /** Gives it new levels. */
  set: (levels: CompactLevels) => void;
} {
  let current: CompactLevels = { you: 0, them: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (levels) => {
      current = levels;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * The overlay, connected to the live page of the same session.
 *
 * @param props See CompactLiveProps.
 * @returns The view.
 * Rendered by: app/compact/[id]/page.tsx
 */
export function CompactLive({ sessionId, closeOnEnd = true, email }: CompactLiveProps) {
  // ADR-0051: with account sync, Dashboard ↗ and the rest open the web app in the browser.
  const synced = useSyncAccount() !== null;
  const [state, setState] = useState<CompactState | null>(null);
  const [askedEmail, setAskedEmail] = useState<string | null>(null);
  const chatBar = useRef<ChatBarHandle>(null);
  const lastChatPress = useRef<number | null>(null);
  const { state: protection, change: changeProtection } = usePrivate();
  const [chatOpen, setChatOpen] = useState(false);
  const [opacity, setOpacity] = useState(getOverlayOpacity);
  const [fade] = useState(getOverlayFade);
  const [panels, setPanels] = useState<OverlayPanels>(getOverlayPanels);
  // The pointer is over the overlay: a state (not a ref) so the panel's background opacity
  // re-paints when fading is on and the pointer comes and goes (ADR-0033). It starts false: the
  // overlay opens without the pointer on it (v1.0.2 started it true, which kept the panel solid).
  const [hovered, setHovered] = useState(false);
  const channel = useRef<LiveChannel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const levels = useMemo(() => createLevelStore(), []);
  // The latest state, for the shortcut handler (added once).
  const stateRef = useRef<CompactState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  });
  // The desktop shell can place, resize and reshape the see-through window (1.0.2+, ADR-0035).
  const placement = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().overlayPlacement(),
    () => false,
  );
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const windowControls = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().overlayWindowControls(),
    () => false,
  );
  // A separate window for pages opened during a call: a desktop app from 1.1.0, or a new tab in a
  // browser. In an older shell it would leave the call's window, or open another browser profile.
  const canOpenPages = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().kind === 'browser' || getPlatform().hasHomePanel(),
    () => false,
  );
  const iconMode = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().overlayIconMode(),
    () => false,
  );
  // v1.3.0 (ADR-0056): the six positions (desktop 1.3.0); the position says which way panels open.
  const positions = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().overlayPositions(),
    () => false,
  );
  const [position, setPosition] = useState<OverlayPreset | null>(null);
  useEffect(() => {
    if (!positions) return;
    const platform = getPlatform();
    const stop = platform.onOverlayPosition(setPosition);
    void platform.getOverlayPosition().then((preset) => {
      if (preset) setPosition(preset);
    });
    return stop;
  }, [positions]);
  // The call's theme (v1.3.0: dark until chosen), not the dashboard's.
  const { theme, resolved, zoom, fontScale } = useAppearance('call', closeOnEnd);

  useEffect(() => {
    const link = openLiveChannel(sessionId);
    channel.current = link;
    link.onState(setState);
    link.onLevels(levels.set);
    // Ask the live page for what it shows now (it answers with a state update).
    link.send({ type: 'hello' });
    return () => {
      link.close();
      channel.current = null;
    };
  }, [sessionId, levels]);

  // The picture-in-picture window has no route of its own to give the email. It is only for the menu.
  useEffect(() => {
    if (email !== undefined) return;
    let active = true;
    authClient
      .getSession()
      .then((result) => {
        if (active) setAskedEmail(result.data?.user.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [email]);

  // ADR-0033: the opacity dims only the panels' background, not the window; the text stays opaque.
  // The window itself is kept fully opaque (older shells could dim it; set it back once). The
  // background opacity painted now is the chosen value; with fading on, more see-through away from
  // the pointer (v1.0.3, ADR-0039: never more solid, so a change always shows at once).
  const panelAlpha = paintedOpacity(opacity, fade, hovered);
  useEffect(() => {
    getPlatform().setOverlayOpacity(1);
  }, []);

  // The shortcuts while the overlay has focus (the page's window: the picture-in-picture window's
  // own document in a browser). Answer and Screenshot reach this only when another app holds the
  // global shortcut.
  useEffect(() => {
    const target = root.current?.ownerDocument.defaultView;
    if (!target) return;
    return getPlatform().listenForFocusedHotkeys(target, (action) => {
      if (action === 'chat') {
        // Pressed twice (spec S14): open, with the microphone on. Once: open or close.
        const now = Date.now();
        if (isDoublePress(lastChatPress.current, now)) {
          setChatOpen(true);
          if (stateRef.current?.dictationSupported) {
            channel.current?.send({ type: 'dictate', on: true });
          }
        } else setChatOpen((open) => !open);
        lastChatPress.current = now;
      } else if (action === 'screenshot-send') chatBar.current?.screenshotSend();
      else if (action === 'script-bar') {
        // Ctrl+Alt+S with the overlay focused: the live page holds the switch (v1.0.2).
        channel.current?.send({ type: 'script-bar', on: !(stateRef.current?.scriptBar ?? false) });
      } else if (action === 'click-through') {
        // v1.3.2: Ctrl+Alt+X with the overlay focused (another app holds it globally): the live page
        // holds the switch.
        channel.current?.send({
          type: 'click-through',
          on: !(stateRef.current?.clickThrough ?? false),
        });
      } else if (action === 'ask-kite') {
        channel.current?.send({ type: 'chat-target', target: 'kite' });
        setChatOpen(true);
      } else if (action === 'record') {
        // Desktop 1.5.0 (ADR-0068): Ctrl+Alt+R with the overlay focused: the bars ask Start or Stop.
        channel.current?.send({ type: 'record-prompt' });
      } else channel.current?.send({ type: action });
    });
  }, []);

  // The Ask Kite shortcut was pressed (the live page counts the presses, ADR-0030): open the box.
  const askKiteCount = state?.askKiteCount ?? 0;
  const [seenAskKite, setSeenAskKite] = useState(0);
  if (askKiteCount !== seenAskKite) {
    setSeenAskKite(askKiteCount);
    if (askKiteCount > seenAskKite) setChatOpen(true);
  }

  // v1.1.0: likewise the Chat shortcut, pressed in another app.
  const chatCount = state?.chatCount ?? 0;
  const [seenChat, setSeenChat] = useState(0);
  if (chatCount !== seenChat) {
    setSeenChat(chatCount);
    if (chatCount > seenChat) setChatOpen(true);
  }

  // v1.2.0: likewise the chat bar's screenshot shortcut. Nothing happens with the bar closed.
  const screenshotSendCount = state?.screenshotSendCount ?? 0;
  const seenScreenshotSend = useRef(0);
  useEffect(() => {
    if (screenshotSendCount > seenScreenshotSend.current) chatBar.current?.screenshotSend();
    seenScreenshotSend.current = screenshotSendCount;
  }, [screenshotSendCount]);

  // v1.2.0: that shortcut is held from other apps only while the bar is open.
  useEffect(() => {
    getPlatform().setChatHotkey(chatOpen);
    return () => getPlatform().setChatHotkey(false);
  }, [chatOpen]);

  // The call ended: close this window shortly (the live page also asks the shell to close it).
  useEffect(() => {
    if (!state?.ended || !closeOnEnd) return;
    const timer = setTimeout(() => window.close(), 1_500);
    return () => clearTimeout(timer);
  }, [state?.ended, closeOnEnd]);

  const changePanels = useCallback((next: OverlayPanels) => {
    setPanels(next);
    setOverlayPanels(next);
  }, []);

  return (
    <div ref={root} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <CompactView
        state={state}
        protection={protection}
        mac={mac}
        email={email ?? askedEmail}
        chatOpen={chatOpen}
        onChatOpen={setChatOpen}
        chatBar={chatBar}
        {...(iconMode
          ? { onMove: (dx: number, dy: number) => getPlatform().moveOverlay(dx, dy) }
          : {})}
        glass={windowControls}
        panels={panels}
        onPanels={changePanels}
        theme={theme}
        resolvedTheme={resolved}
        zoom={zoom}
        fontScale={fontScale}
        levels={levels}
        onCommand={(command) => channel.current?.send(command)}
        onMode={(mode) => getPlatform().setOverlayMode(mode)}
        onLayout={(layout: OverlayLayout) => getPlatform().setOverlayLayout(layout)}
        // ADR-0055 (accounts with account sync): the reference app's bars and chat bar, and clicks
        // passing through the gaps to the app behind (desktop 1.3.0).
        referenceLook={synced}
        {...(windowControls && synced
          ? {
              onClickThrough: (through: boolean) => getPlatform().setOverlayClickThrough(through),
              // v1.3.2: a click on a panel's button gives the keyboard back to the app behind.
              onReleaseFocus: () => getPlatform().releaseOverlayFocus(),
            }
          : {})}
        {...(placement
          ? {
              onResize: (step: OverlayResizeStep) => getPlatform().resizeOverlay(step),
              onPlace: (preset: OverlayPreset) => getPlatform().placeOverlay(preset),
            }
          : {})}
        {...(positions
          ? {
              position,
              onPosition: (preset: OverlayPreset) => getPlatform().setOverlayPosition(preset),
            }
          : {})}
        {...(synced
          ? {
              // ADR-0051: with account sync, the dashboard is the web app, in the system browser.
              onDashboard: () => openDashboard('/'),
              onHelp: () => openDashboard('/help'),
              onEditSession: () => openDashboard(`/sessions/${sessionId}/edit`),
            }
          : canOpenPages
            ? {
                onDashboard: () => getPlatform().openPagesWindow('/'),
                onHelp: () => getPlatform().openPagesWindow('/help'),
                onEditSession: () => getPlatform().openPagesWindow(`/sessions/${sessionId}/edit`),
              }
            : {})}
        onProtection={changeProtection}
        {...(windowControls
          ? {
              windowSettings: {
                opacity,
                panelAlpha,
                onOpacity: (value: number) => {
                  setOpacity(value);
                  setOverlayOpacityPref(value);
                },
              },
            }
          : {})}
      />
    </div>
  );
}
