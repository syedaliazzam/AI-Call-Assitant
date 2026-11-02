/**
 * File: apps/web/src/features/live/CompactLive.tsx
 * Purpose: The overlay's live side: connects CompactView to the live page of the same session over
 *          the session channel, applies its opacity and fade through the platform, and handles
 *          the shortcuts while the overlay itself has focus. In the desktop overlay window and in
 *          the browser's picture-in-picture window.
 * Used by: app/compact/[id]/page.tsx (desktop overlay window),
 *          src/features/live/LiveAnswers.tsx (browser picture-in-picture)
 * Depends on: src/core/live/liveChannel.ts, src/core/storage/overlayPrefs.ts, src/platform,
 *             src/features/live/CompactView.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §7.1; ADR-0029
 */
'use client';

import type { ShareProtectionState } from '@kite/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { openLiveChannel, type CompactState, type LiveChannel } from '@/core/live/liveChannel';
import {
  getOverlayFade,
  getOverlayOpacity,
  setOverlayFadePref,
  setOverlayOpacityPref,
} from '@/core/storage/overlayPrefs';
import { getPlatform } from '@/platform';
import { CompactView } from './CompactView';

/** Props for CompactLive. */
export interface CompactLiveProps {
  /** The live session's id (from the URL). */
  sessionId: string;
  /**
   * Close the window when the call ends (default true: the desktop overlay window). Inside a
   * browser picture-in-picture window, 'window' is the main page, so the platform closes it.
   */
  closeOnEnd?: boolean;
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
 * The overlay, connected to the live page of the same session.
 *
 * @param props See CompactLiveProps.
 * @returns The view.
 * Rendered by: app/compact/[id]/page.tsx
 */
export function CompactLive({ sessionId, closeOnEnd = true }: CompactLiveProps) {
  const [state, setState] = useState<CompactState | null>(null);
  const [protection, setProtection] = useState<ShareProtectionState | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [opacity, setOpacity] = useState(getOverlayOpacity);
  const [fade, setFade] = useState(getOverlayFade);
  const hovered = useRef(true);
  const channel = useRef<LiveChannel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const windowControls = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().overlayWindowControls(),
    () => false,
  );

  useEffect(() => {
    const link = openLiveChannel(sessionId);
    channel.current = link;
    link.onState(setState);
    // Ask the live page for what it shows now (it answers with a state update).
    link.send({ type: 'hello' });
    getPlatform()
      .getShareProtection()
      .then(setProtection)
      .catch(() => undefined);
    return () => {
      link.close();
      channel.current = null;
    };
  }, [sessionId]);

  /**
   * Applies the opacity the window should have now: fully visible while the pointer is over it
   * when fading is on, the chosen opacity otherwise.
   *
   * @param value The chosen opacity.
   * @param fades Whether fading is on.
   * @returns Nothing.
   */
  const apply = useCallback((value: number, fades: boolean) => {
    getPlatform().setOverlayOpacity(fades && hovered.current ? 1 : value);
  }, []);

  useEffect(() => {
    apply(opacity, fade);
  }, [apply, opacity, fade]);

  // The shortcuts while the overlay has focus (the page's window: the picture-in-picture window's
  // own document in a browser). Answer and Screenshot reach this only when another app holds the
  // global shortcut.
  useEffect(() => {
    const target = root.current?.ownerDocument.defaultView;
    if (!target) return;
    return getPlatform().listenForFocusedHotkeys(target, (action) => {
      if (action === 'chat') setChatOpen((open) => !open);
      else if (action === 'ask-kite') {
        channel.current?.send({ type: 'chat-target', target: 'kite' });
        setChatOpen(true);
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

  // The call ended: close this window shortly (the live page also asks the shell to close it).
  useEffect(() => {
    if (!state?.ended || !closeOnEnd) return;
    const timer = setTimeout(() => window.close(), 1_500);
    return () => clearTimeout(timer);
  }, [state?.ended, closeOnEnd]);

  return (
    <div
      ref={root}
      onMouseEnter={() => {
        hovered.current = true;
        apply(opacity, fade);
      }}
      onMouseLeave={() => {
        hovered.current = false;
        apply(opacity, fade);
      }}
    >
      <CompactView
        state={state}
        protection={protection}
        mac={mac}
        chatOpen={chatOpen}
        onChatOpen={setChatOpen}
        glass={windowControls}
        onCommand={(command) => channel.current?.send(command)}
        onCollapsed={(collapsed) => getPlatform().setOverlayCollapsed(collapsed)}
        onProtection={(on) => {
          getPlatform()
            .setShareProtection(on)
            .then(setProtection)
            .catch(() => undefined);
        }}
        {...(windowControls
          ? {
              windowSettings: {
                opacity,
                fade,
                onOpacity: (value: number) => {
                  setOpacity(value);
                  setOverlayOpacityPref(value);
                },
                onFade: (on: boolean) => {
                  setFade(on);
                  setOverlayFadePref(on);
                },
              },
            }
          : {})}
      />
    </div>
  );
}
