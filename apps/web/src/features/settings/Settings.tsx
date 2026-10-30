/**
 * File: apps/web/src/features/settings/Settings.tsx
 * Purpose: The Settings page: default preferences for new sessions, the hotkey list
 *          (read-only; the shortcuts themselves arrive on Day 4), the screen-share protection
 *          switch (Day 5), and "Delete all local data" (asks first, then shows what was
 *          deleted).
 * Used by: app/(app)/settings/page.tsx
 * Depends on: src/core/storage (settings, wipe), src/ui (Button, Dialog, Select, Textarea,
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
import { deleteAllLocalData, type DeletedCounts } from '@/core/storage/wipe';
import {
  FORMAT_OPTIONS,
  LENGTH_OPTIONS,
  MODEL_OPTIONS,
  TONE_OPTIONS,
} from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { Toggle } from '@/ui/Toggle';

/**
 * The default hotkeys (architecture §7.3), shown read-only. Display text only: the shortcuts
 * are registered on Day 4, which will take this list from the shared hotkey definitions.
 */
const HOTKEYS: readonly {
  /** What the hotkey does. */
  action: string;
  /** Keys on macOS. */
  mac: string;
  /** Keys on Windows. */
  windows: string;
}[] = [
  { action: 'Answer', mac: '⌘ Enter', windows: 'Ctrl + Enter' },
  { action: 'Screenshot', mac: '⌘ Shift Enter', windows: 'Ctrl + Shift + Enter' },
  { action: 'Clear / cancel', mac: '⌘ Backspace', windows: 'Ctrl + Backspace' },
  { action: 'Previous / next answer', mac: '⌘ ← / ⌘ →', windows: 'Ctrl + ← / Ctrl + →' },
];

/**
 * A titled section of the page.
 *
 * @param props.title    Section heading.
 * @param props.children Section content.
 * @returns The section.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Saved on this computer only.</p>
      </header>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <Section title="Defaults for new sessions">
        {defaults ? (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-slate-500">
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
                <span role="status" className="text-sm text-green-700">
                  Saved.
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </Section>

      <Section title="Hotkeys">
        <p className="mb-3 text-sm text-slate-500">
          Shown for reference; the shortcuts start working on Day 4. In the browser they work while
          Kite has focus; in the desktop app, from any app.
        </p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th scope="col" className="py-2 pr-4 font-medium">
                Action
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                macOS
              </th>
              <th scope="col" className="py-2 font-medium">
                Windows
              </th>
            </tr>
          </thead>
          <tbody>
            {HOTKEYS.map((hotkey) => (
              <tr key={hotkey.action} className="border-b border-slate-100">
                <th scope="row" className="py-2 pr-4 font-medium text-slate-800">
                  {hotkey.action}
                </th>
                <td className="py-2 pr-4 text-slate-600">{hotkey.mac}</td>
                <td className="py-2 text-slate-600">{hotkey.windows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Screen-share protection">
        <Toggle
          label="Hide Kite's live window when you share your screen"
          hint="Desktop app only; arrives on Day 5."
          checked={false}
          onChange={() => undefined}
          disabled
        />
      </Section>

      <Section title="Local data">
        <p className="mb-4 text-sm text-slate-600">
          Deletes every session, document, transcript and answer saved by Kite on this computer, and
          these settings. The speech model stays (it holds no personal data and is 204 MB to
          download again). Sessions in another browser or in the desktop app are separate and are
          not affected.
        </p>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Delete all local data
        </Button>
        {deleted && (
          <p role="status" className="mt-3 text-sm text-green-700">
            Deleted {deleted.sessions} sessions, {deleted.documents} documents, {deleted.utterances}{' '}
            transcript lines, {deleted.answers} answers and {deleted.notes} notes.
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
          Every session, document, transcript and answer Kite saved on this computer will be
          deleted. This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
