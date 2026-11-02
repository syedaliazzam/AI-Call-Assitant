/**
 * File: apps/web/src/features/settings/Settings.tsx
 * Purpose: The Settings page: default preferences for new sessions, the hotkey list
 *          (read-only; the shortcuts themselves arrive on Day 4), the screen-share protection
 *          switch (Day 5), "What Kite has learned" (Day 5 Stage 7: LearnedLessons.tsx), and
 *          "Export my data" and "Import data" (Day 6, DataTransfer.tsx), and "Delete all local
 *          data" (asks first, then shows what was deleted).
 * Used by: app/(app)/settings/page.tsx
 * Depends on: src/core/storage (settings, wipe), src/platform (share protection),
 *             src/ui (Button, Dialog, Select, Textarea,
 *             Toggle), src/features/session-setup/labels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Settings), §7.3 (default
 *               hotkeys), §8.1; day-03-sessions.md Stage 3
 */
'use client';

import type { ShareProtectionState } from '@kite/shared';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BUILT_IN_DEFAULTS,
  getSessionDefaults,
  saveSessionDefaults,
} from '@/core/storage/settings';
import type { SessionDefaults } from '@/core/storage/types';
import { deleteAllLocalData, type DeletedCounts } from '@/core/storage/wipe';
import {
  FORMAT_OPTIONS,
  LENGTH_OPTIONS,
  MODEL_OPTIONS,
  TONE_OPTIONS,
} from '@/features/session-setup/labels';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { PageShell } from '@/ui/PageShell';
import { Toggle } from '@/ui/Toggle';
import { AnswerPrefsSetting } from './AnswerPrefsSetting';
import { AutoAnswerSetting } from './AutoAnswerSetting';
import { DataTransfer } from './DataTransfer';
import { HotkeyList } from './HotkeyList';
import { LearnedLessons } from './LearnedLessons';
import { OverlaySetting } from './OverlaySetting';

/**
 * A titled section of the page.
 *
 * @param props.title    Section heading.
 * @param props.children Section content.
 * @returns The section.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="border border-ui-border rounded-card bg-ui-surface shadow-card p-6"
    >
      <h2 className="mb-4 text-[18px] font-semibold text-ui-heading">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The screen-share protection switch (Day 5). In the desktop app it turns the compact window's
 * protection on or off (setContentProtection only; the window still shows in the taskbar and
 * Alt+Tab). In a browser it explains what to do instead.
 *
 * @returns The switch, or the guidance.
 */
function ShareProtectionSetting() {
  const [state, setState] = useState<ShareProtectionState | null>(null);
  useEffect(() => {
    getPlatform()
      .getShareProtection()
      .then(setState)
      .catch(() => undefined);
  }, []);
  if (!state) return <p className="text-[13px] text-ui-muted">Checking…</p>;
  if (!state.supported) {
    return (
      <p className="text-[13px] text-ui-muted">
        {getPlatform().kind === 'desktop'
          ? 'This computer cannot hide a window from screen sharing. Share a single window instead of the whole screen, or keep Kite on another monitor.'
          : 'A browser cannot hide its windows from screen sharing. In the meeting, share a single tab or window instead of the whole screen, or keep Kite on another monitor. The Kite desktop app can hide its compact window.'}
      </p>
    );
  }
  return (
    <Toggle
      label="Hide the compact window from screen sharing"
      hint="On: people you share your whole screen with do not see Kite's compact window (Windows 10 version 2004 or later). The window still appears in your taskbar and Alt+Tab. On macOS, some apps that use the newer capture system may still show it."
      checked={state.on}
      onChange={(on) => {
        getPlatform()
          .setShareProtection(on)
          .then(setState)
          .catch(() => undefined);
      }}
    />
  );
}

/**
 * The Settings page.
 *
 * @returns The page content.
 * Rendered by: app/(app)/settings/page.tsx
 */
export function Settings() {
  const [defaults, setDefaults] = useState<SessionDefaults | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState<DeletedCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSessionDefaults()
      .then((loaded) => {
        if (!cancelled) setDefaults(loaded);
      })
      .catch(() => {
        if (!cancelled) setError('Kite could not open its local storage. Reload the page.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Changes the defaults being edited (not saved until Save).
   *
   * @param changes Fields to change.
   */
  function change(changes: Partial<SessionDefaults>) {
    setDefaults((current) => (current ? { ...current, ...changes } : current));
    setSaved(false);
  }

  /** Saves the defaults. */
  async function save() {
    if (!defaults) return;
    try {
      await saveSessionDefaults(defaults);
      setSaved(true);
    } catch {
      setError('The defaults could not be saved on this computer.');
    }
  }

  /** Deletes all local data after confirmation and shows the counts. */
  async function wipe() {
    setDeleting(true);
    try {
      setDeleted(await deleteAllLocalData());
      setDefaults(BUILT_IN_DEFAULTS);
      setSaved(false);
    } catch {
      setError('The local data could not be deleted. Close other Kite tabs and try again.');
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <PageShell eyebrow="Kite" title="Settings" description="Saved on this computer only.">
      {error && (
        <p role="alert" className="text-[13px] text-ui-danger">
          {error}
        </p>
      )}

      <Section title="Defaults for new sessions">
        {defaults ? (
          <div className="flex flex-col gap-5">
            <p className="text-[13px] text-ui-muted">
              New sessions start with these; each session can change them. Existing sessions keep
              their own.
            </p>
            <Select
              label="Model"
              options={MODEL_OPTIONS}
              value={defaults.model}
              onChange={(model) => change({ model })}
            />
            <div className="grid gap-5 sm:grid-cols-3">
              <Select
                label="Answer format"
                options={FORMAT_OPTIONS}
                value={defaults.style.format}
                onChange={(format) => change({ style: { ...defaults.style, format } })}
              />
              <Select
                label="Length"
                options={LENGTH_OPTIONS}
                value={defaults.style.length}
                onChange={(length) => change({ style: { ...defaults.style, length } })}
              />
              <Select
                label="Tone"
                options={TONE_OPTIONS}
                value={defaults.style.tone}
                onChange={(tone) => change({ style: { ...defaults.style, tone } })}
              />
            </div>
            <Textarea
              label="AI instructions"
              value={defaults.instructions}
              onChange={(event) => change({ instructions: event.target.value })}
              rows={3}
              maxLength={5_000}
            />
            <Toggle
              label="Save transcript"
              checked={defaults.saveTranscript}
              onChange={(saveTranscript) => change({ saveTranscript })}
            />
            <div className="flex items-center gap-3">
              <Button onClick={() => void save()}>Save defaults</Button>
              {saved && (
                <span role="status" className="text-[13px] text-ui-success">
                  Saved.
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ui-muted">Loading…</p>
        )}
      </Section>

      <Section title="Hotkeys">
        <HotkeyList />
      </Section>

      <Section title="Overlay">
        <OverlaySetting />
      </Section>

      <Section title="Screen-share protection">
        <ShareProtectionSetting />
      </Section>

      <Section title="Answers">
        <div className="flex flex-col gap-5">
          <AutoAnswerSetting />
          <AnswerPrefsSetting />
        </div>
      </Section>

      <Section title="What Kite has learned">
        {/* Remounted after "Delete all local data", so the list shows the empty store. */}
        <LearnedLessons key={deleted ? 'wiped' : 'kept'} />
      </Section>

      <Section title="Local data">
        <DataTransfer />
        <p className="mb-4 text-[13px] text-ui-muted">
          Deletes every session, document, transcript, answer, Ask Kite chat and learned lesson
          saved by Kite on this computer, and these settings. The speech model stays (it holds no
          personal data and is 204 MB to download again). Sessions in another browser or in the
          desktop app are separate and are not affected.
        </p>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Delete all local data
        </Button>
        {deleted && (
          <p role="status" className="mt-3 text-[13px] text-ui-success">
            Deleted {deleted.sessions} sessions, {deleted.documents} documents, {deleted.utterances}{' '}
            transcript lines, {deleted.answers} answers, {deleted.notes} notes, {deleted.lessons}{' '}
            lessons and {deleted.chats} Ask Kite chats.
          </p>
        )}
      </Section>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete all local data?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void wipe()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </>
        }
      >
        <p>
          Every session, document, transcript, answer and learned lesson Kite saved on this computer
          will be deleted. This cannot be undone.
        </p>
      </Dialog>
    </PageShell>
  );
}
