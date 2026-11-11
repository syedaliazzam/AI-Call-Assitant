/**
 * File: apps/web/src/features/settings/Settings.tsx
 * Purpose: The Settings page: default preferences for new sessions, the hotkey list
 *          (read-only; the shortcuts themselves arrive on Day 4), the screen-share protection
 *          switch (Day 5), "What Kite has learned" (Day 5 Stage 7: LearnedLessons.tsx), and
 *          "Export my data" and "Import data" (Day 6, DataTransfer.tsx), "Delete all local
 *          data" (asks first, then shows what was deleted), Recording (desktop 1.5.0, ADR-0068:
 *          RecordingSetting.tsx), and Google Drive (1.6.0, ADR-0072: features/drive/GoogleDriveSetting.tsx).
 * Used by: app/(app)/settings/page.tsx
 * Depends on: src/core/storage (settings, wipe, db), src/core/sync/client.ts (Delete all my data,
 *             ADR-0049), src/platform (share protection),
 *             src/ui (Button, Dialog, Select, Textarea,
 *             Toggle), src/features/session-setup/labels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Settings), §7.3 (default
 *               hotkeys), §8.1; day-03-sessions.md Stage 3
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  BUILT_IN_DEFAULTS,
  getSessionDefaults,
  saveSessionDefaults,
} from '@/core/storage/settings';
import type { SessionDefaults } from '@/core/storage/types';
import { usingAccountDatabase } from '@/core/storage/db';
import { deleteAllLocalData, type DeletedCounts } from '@/core/storage/wipe';
import { deleteAllAccountData } from '@/core/sync/client';
import {
  FORMAT_OPTIONS,
  LENGTH_OPTIONS,
  MODEL_OPTIONS,
  TONE_OPTIONS,
} from '@/features/session-setup/labels';
import { PRIVATE_LABEL, privateHint, usePrivate } from '@/features/privacy/usePrivate';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { PageShell } from '@/ui/PageShell';
import { Toggle } from '@/ui/Toggle';
import { AnswerPrefsSetting } from './AnswerPrefsSetting';
import { AutoAnswerSetting } from './AutoAnswerSetting';
import { CallTimingLog } from './CallTimingLog';
import { CompanySuggestionsSetting } from './CompanySuggestionsSetting';
import { DataTransfer } from './DataTransfer';
import { HotkeyList } from './HotkeyList';
import { LearnedLessons } from './LearnedLessons';
import { OverlaySetting } from './OverlaySetting';
import { TranscriptionSetting } from './TranscriptionSetting';
import { RecordingSetting } from './RecordingSetting';
import { GoogleDriveSetting } from '@/features/drive/GoogleDriveSetting';

/**
 * A titled section of the page.
 *
 * @param props.title    Section heading.
 * @param props.children Section content.
 * @param props.id       The section's anchor (for example "google-drive" for /settings#google-drive).
 * @returns The section.
 */
function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section
      id={id}
      aria-label={title}
      className="border border-ui-border rounded-card bg-ui-surface shadow-card p-6"
    >
      <h2 className="mb-4 text-[18px] font-semibold text-ui-heading">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The Private switch (screen-share protection; one toggle and one state with both ⋮ menus,
 * ADR-0042). setContentProtection only: Kite's windows still show in the taskbar and Alt+Tab. In a
 * browser it explains what to do instead.
 *
 * @returns The switch, or the guidance.
 */
function ShareProtectionSetting() {
  const { state, change } = usePrivate();
  if (!state) return <p className="text-[13px] text-ui-muted">Checking…</p>;
  if (!state.supported) {
    return <p className="text-[13px] text-ui-muted">{privateHint(state)}</p>;
  }
  return (
    <Toggle label={PRIVATE_LABEL} hint={privateHint(state)} checked={state.on} onChange={change} />
  );
}

/** Props for Settings. */
export interface SettingsProps {
  /** True for an admin: passed to the Answers section for the answer-style rollback switch (ADR-0032). */
  isAdmin: boolean;
}

/**
 * The Settings page.
 *
 * @param props See SettingsProps.
 * @returns The page content.
 * Rendered by: app/(app)/settings/page.tsx
 */
export function Settings({ isAdmin }: SettingsProps) {
  const [defaults, setDefaults] = useState<SessionDefaults | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // ADR-0049: with account sync, deleting removes the data from the account, on every device.
  // Fixed for the page: SyncScope chose the database before this page rendered.
  const [synced] = useState(() => usingAccountDatabase());
  const [deleted, setDeleted] = useState<DeletedCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSessionDefaults()
      .then((loaded) => {
        if (!cancelled) setDefaults(loaded);
      })
      .catch(() => {
        if (!cancelled) setError('Paramount AI could not open its local storage. Reload the page.');
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
      setDeleted(await (synced ? deleteAllAccountData() : deleteAllLocalData()));
      setDefaults(BUILT_IN_DEFAULTS);
      setSaved(false);
    } catch {
      setError(
        synced
          ? 'Your data could not be deleted. Check your connection and try again; nothing was deleted.'
          : 'The local data could not be deleted. Close other Paramount AI tabs and try again.',
      );
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <PageShell title="Settings">
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

      <Section title="Privacy">
        <CompanySuggestionsSetting />
      </Section>

      <Section title="Screen-share protection">
        <ShareProtectionSetting />
      </Section>

      {/* v1.0.1 (ADR-0034): the opt-in accurate engine (desktop app only). */}
      <Section title="Transcription">
        <div className="flex flex-col gap-5">
          <TranscriptionSetting />
          {/* 1.5.1 (ADR-0069): the device-side call timing log, for the re-test. */}
          <CallTimingLog />
        </div>
      </Section>

      {/* Desktop 1.5.0 (ADR-0068): meeting recording. */}
      <Section title="Recording">
        <RecordingSetting />
      </Section>

      <Section title="Google Drive" id="google-drive">
        <GoogleDriveSetting />
      </Section>

      <Section title="Answers">
        <div className="flex flex-col gap-5">
          <AutoAnswerSetting />
          <AnswerPrefsSetting isAdmin={isAdmin} />
        </div>
      </Section>

      <Section title="What Paramount AI has learned">
        {/* Remounted after "Delete all local data", so the list shows the empty store. */}
        <LearnedLessons key={deleted ? 'wiped' : 'kept'} />
      </Section>

      <Section title={synced ? 'Your data' : 'Local data'}>
        <DataTransfer />
        {synced ? (
          <p className="mb-4 text-[13px] text-ui-muted">
            Deletes every session, document, transcript, answer, Ask AI chat and learned lesson in
            your account, on every device signed in to it, and these settings. They are removed from
            the server at once; the database provider&apos;s short-term backups keep them only until
            those expire. The speech model stays on this computer (it holds no personal data).
          </p>
        ) : (
          <p className="mb-4 text-[13px] text-ui-muted">
            Deletes every session, document, transcript, answer, Ask AI chat and learned lesson
            saved by Paramount AI on this computer, and these settings. The speech model stays (it
            holds no personal data and is 204 MB to download again). Sessions in another browser or
            in the desktop app are separate and are not affected.
          </p>
        )}
        <Button variant="danger" onClick={() => setConfirming(true)}>
          {synced ? 'Delete all my data' : 'Delete all local data'}
        </Button>
        {deleted && (
          <p role="status" className="mt-3 text-[13px] text-ui-success">
            Deleted {deleted.sessions} sessions, {deleted.documents} documents, {deleted.utterances}{' '}
            transcript lines, {deleted.answers} answers, {deleted.notes} notes, {deleted.lessons}{' '}
            lessons and {deleted.chats} Ask AI chats.
          </p>
        )}
      </Section>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={synced ? 'Delete all your data?' : 'Delete all local data?'}
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
          {synced
            ? 'Every session, document, transcript, answer and learned lesson in your account will be deleted, on every device signed in to it. This cannot be undone.'
            : 'Every session, document, transcript, answer and learned lesson Paramount AI saved on this computer will be deleted. This cannot be undone.'}
        </p>
      </Dialog>
    </PageShell>
  );
}
