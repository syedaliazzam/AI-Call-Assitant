/**
 * File: apps/web/src/features/live/ConnectGuide.tsx
 * Purpose: "How to connect" on the Connect screen: one simple icon per way of calling (Zoom, Teams,
 *          Google Meet, Webex, phone), each opening a short how-to for this platform; a video
 *          tutorial placeholder; and a link to a practice video for testing without a call.
 * Used by: src/features/live/ConnectPanel.tsx
 * Depends on: src/ui (Button, Dialog, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (desktop vs browser), §5 (Connect);
 *               ADR-0029
 *
 * The icons are generic line drawings, not the apps' logos.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { ChatPeopleIcon, MeetingScreenIcon, PhoneIcon, VideoIcon, WebcamIcon } from '@/ui/icons';

/** Which platform the page runs on. */
type Platform = 'desktop' | 'browser';

/** One way of calling. */
interface CallApp {
  /** Its name. */
  name: string;
  /** Its generic icon. */
  icon: ReactNode;
  /** Whether it can run inside a browser tab. */
  hasWebVersion: boolean;
}

/** The ways of calling, in the order shown. */
const APPS: readonly CallApp[] = [
  { name: 'Zoom', icon: <VideoIcon size={22} />, hasWebVersion: true },
  { name: 'Teams', icon: <ChatPeopleIcon size={22} />, hasWebVersion: true },
  { name: 'Google Meet', icon: <MeetingScreenIcon size={22} />, hasWebVersion: true },
  { name: 'Webex', icon: <WebcamIcon size={22} />, hasWebVersion: true },
  { name: 'Phone', icon: <PhoneIcon size={22} />, hasWebVersion: false },
];

/** A public search for practice interviews, for trying Kite without a real call. */
const MOCK_VIDEO_URL = 'https://www.youtube.com/results?search_query=mock+job+interview';

/**
 * The how-to for one app on this platform.
 *
 * @param props.app      The app.
 * @param props.platform Desktop app or browser.
 * @returns The steps.
 * Rendered by: ConnectGuide (inside its dialog)
 */
function Steps({ app, platform }: { app: CallApp; platform: Platform }) {
  if (!app.hasWebVersion) {
    return platform === 'desktop' ? (
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Use an app that plays the call on this computer, for example your phone&rsquo;s link app
          or a calling app.
        </li>
        <li>
          Press <strong>Connect</strong>, then start the call. Paramount AI hears your microphone
          and what this computer plays.
        </li>
        <li>
          A call held only on the phone itself cannot reach Paramount AI as &ldquo;Them&rdquo;.
        </li>
      </ol>
    ) : (
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          A browser can only hear a tab, so phone calls need a web calling app in another tab.
        </li>
        <li>
          Otherwise use the Paramount AI desktop app, which hears anything this computer plays.
        </li>
      </ol>
    );
  }
  if (platform === 'desktop') {
    return (
      <ol className="list-decimal space-y-2 pl-5">
        <li>Join your {app.name} call the usual way, in its app or in a browser.</li>
        <li>
          Press <strong>Connect</strong>. Paramount AI hears your microphone and what this computer
          plays, with nothing to pick.
        </li>
        <li>
          After the short sound check, press <strong>Go live</strong>.
        </li>
      </ol>
    );
  }
  return (
    <ol className="list-decimal space-y-2 pl-5">
      <li>Open {app.name} on the web in another Chrome or Edge tab and join the call there.</li>
      <li>
        Press <strong>Connect</strong>, choose the tab with your call, and turn on{' '}
        <strong>Also share tab audio</strong>.
      </li>
      <li>Allow the microphone when asked, then press Go live after the sound check.</li>
    </ol>
  );
}

/**
 * How to connect.
 *
 * @param props.platform Desktop app or browser.
 * @returns The icons, the tutorial placeholder and the practice video link.
 * Rendered by: ConnectPanel.tsx
 */
export function ConnectGuide({
  platform,
}: {
  /** Desktop app or browser. */
  platform: Platform;
}) {
  const [app, setApp] = useState<CallApp | null>(null);
  return (
    <div className="flex flex-col gap-3 text-[13px] text-ui-text">
      <ul aria-label="Ways of calling" className="flex flex-wrap gap-2">
        {APPS.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              onClick={() => setApp(item)}
              className="flex min-w-20 flex-col items-center gap-1 border border-ui-border rounded-card bg-ui-surface shadow-card px-3 py-2 text-[13px] text-ui-text hover:border-ui-link focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
            >
              {item.icon}
              {item.name}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-ui-muted">
        {platform === 'desktop'
          ? 'Press one to see how, or just join your call and press Connect.'
          : 'Press one to see how. Chrome or Edge only: Safari and Firefox cannot share a tab’s sound.'}
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span className="text-ui-muted">Video tutorial: coming soon</span>
        <a
          href={MOCK_VIDEO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-ui-link underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          No call to share? Open a mock interview video
        </a>
      </div>
      <Dialog
        open={app !== null}
        onClose={() => setApp(null)}
        title={app ? `Connect ${app.name}` : 'Connect'}
        footer={<Button onClick={() => setApp(null)}>Got it</Button>}
      >
        {app && <Steps app={app} platform={platform} />}
      </Dialog>
    </div>
  );
}
