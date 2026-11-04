/**
 * File: apps/web/src/features/session-setup/SessionWizard.tsx
 * Purpose: The Create / Edit session wizard: step 1 Details (with resume and documents from the
 *          libraries), step 2 Preferences, with Back / Next / Create (or Save). It keeps what was
 *          typed when moving between steps, checks the required fields, and saves the session with
 *          its own copy of its documents in one go.
 * Used by: app/(app)/sessions/new/page.tsx, app/(app)/sessions/[id]/edit/page.tsx
 * Depends on: src/core/storage (sessions, documents, settings, persist),
 *             src/core/documents/limits.ts, ./DetailsStep.tsx, ./PreferencesStep.tsx,
 *             ./draft.ts, ./WizardGuide.tsx, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F2, F3), §5 (Create session),
 *               §7.4; day-03-sessions.md Stage 3
 *
 * Session details and document text are the user's content: kept on this device and never
 * logged.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fitsInSession } from '@/core/documents/limits';
import { listDocuments } from '@/core/storage/documents';
import { requestPersistentStorage } from '@/core/storage/persist';
import {
  createSessionWithDocuments,
  getSession,
  updateSessionWithDocuments,
} from '@/core/storage/sessions';
import { getSessionDefaults } from '@/core/storage/settings';
import { SESSION_TYPES, type LibraryItem, type SessionType } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { Eyebrow } from '@/ui/Eyebrow';
import { LinkButton } from '@/ui/LinkButton';
import { DetailsStep } from './DetailsStep';
import {
  draftChars,
  draftFromSession,
  draftToInput,
  emptyDraft,
  newDocuments,
  validateDetails,
  withLibraryItem,
  withoutDocument,
  type SessionDraft,
} from './draft';
import { PreferencesStep } from './PreferencesStep';
import { WizardGuide } from './WizardGuide';

/** Props for SessionWizard. */
export interface SessionWizardProps {
  /** 'create' for a new session, 'edit' to change an existing one. */
  mode: 'create' | 'edit';
  /** The session to edit (edit mode only). */
  sessionId?: string;
  /** The type to start with, from the dashboard's menu (create mode; anything unknown is ignored). */
  initialType?: string;
}

/** Where loading the wizard's starting point stands. */
type LoadState = 'loading' | 'ready' | 'not-found' | 'failed';

/**
 * The Create / Edit session wizard.
 *
 * @param props See SessionWizardProps.
 * @returns The wizard, or a loading / not-found message.
 * Rendered by: app/(app)/sessions/new/page.tsx, app/(app)/sessions/[id]/edit/page.tsx
 */
export function SessionWizard({ mode, sessionId, initialType }: SessionWizardProps) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>('loading');
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  // The latest draft, for code that runs after an await (state updates are not visible there).
  const draftRef = useRef<SessionDraft | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [showErrors, setShowErrors] = useState(false);
  const [readingCount, setReadingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the starting point: the defaults from Settings (create) or the stored session (edit).
  useEffect(() => {
    let cancelled = false;
    const type = SESSION_TYPES.find((known: SessionType) => known === initialType);
    const start =
      mode === 'create'
        ? getSessionDefaults().then((defaults) => emptyDraft(defaults, type))
        : getSession(sessionId ?? '').then(async (session) =>
            session ? draftFromSession(session, await listDocuments(session.id)) : null,
          );
    start
      .then((initial) => {
        if (cancelled) return;
        draftRef.current = initial;
        setDraft(initial);
        setLoad(initial ? 'ready' : 'not-found');
      })
      .catch(() => {
        if (!cancelled) setLoad('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [mode, sessionId, initialType]);

  /**
   * Applies changes to the draft (state and ref together).
   *
   * @param changes Fields to change.
   */
  function change(changes: Partial<SessionDraft>) {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...changes };
    draftRef.current = next;
    setDraft(next);
  }

  /**
   * Chooses a library item for the session, if it fits. A resume replaces the current one, so the
   * current one's size does not count against it.
   *
   * @param item The library item.
   * @returns Why it does not fit, or null when it was added.
   */
  function pick(item: LibraryItem): string | null {
    const current = draftRef.current;
    if (!current) return null;
    const replaced =
      item.kind === 'resume'
        ? current.documents
            .filter((document) => document.kind === 'resume')
            .reduce((sum, document) => sum + document.chars, 0)
        : 0;
    const fit = fitsInSession(item.chars, draftChars(current) - replaced);
    if (!fit.ok) return fit.message;
    change(withLibraryItem(current, item, crypto.randomUUID()));
    return null;
  }

  /**
   * Removes a document from the draft (a stored one is deleted when the wizard saves).
   *
   * @param key The document's list key.
   */
  function removeDocument(key: string) {
    if (draftRef.current) change(withoutDocument(draftRef.current, key));
  }

  /** Goes to step 2 when the required details are filled in. */
  function next() {
    if (!draftRef.current) return;
    if (Object.keys(validateDetails(draftRef.current)).length > 0) {
      setShowErrors(true);
      return;
    }
    setStep(2);
  }

  /** Saves the session (and its documents), then returns to the dashboard. */
  async function save() {
    const current = draftRef.current;
    if (!current) return;
    if (Object.keys(validateDetails(current)).length > 0) {
      setShowErrors(true);
      setStep(1);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'create') {
        await createSessionWithDocuments(draftToInput(current), newDocuments(current));
        // Ask the browser to keep Kite's data; the answer only affects eviction under disk
        // pressure, so it is not waited for or shown.
        void requestPersistentStorage();
      } else {
        await updateSessionWithDocuments(
          sessionId ?? '',
          draftToInput(current),
          newDocuments(current),
          current.removedIds,
        );
      }
      router.push('/');
    } catch {
      setSaveError(
        'The session could not be saved on this computer. Check that the disk is not full, then try again.',
      );
      setSaving(false);
    }
  }

  const title = mode === 'create' ? 'Create session' : 'Edit session';

  if (load !== 'ready' || !draft) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <h1 className="text-[24px] font-semibold text-ui-heading">{title}</h1>
        <p className="mt-4 text-[15px] text-ui-muted">
          {load === 'loading' && 'Loading…'}
          {load === 'not-found' &&
            'This session does not exist on this computer. Sessions are saved per browser and per desktop app, so a session created elsewhere does not appear here.'}
          {load === 'failed' &&
            'Paramount AI could not open its local storage. Reload the page to try again.'}
        </p>
        {load !== 'loading' && (
          <LinkButton href="/" className="mt-4">
            Back to Call Sessions
          </LinkButton>
        )}
      </div>
    );
  }

  const errors = showErrors ? validateDetails(draft) : {};
  return (
    <div className="flex min-h-full flex-col">
      {/* White header band with the step, then the form on the grey band. */}
      <header className="border-b border-ui-border bg-ui-surface px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <Eyebrow>
            Step {step} of 2 · {step === 1 ? 'Details' : 'Preferences'}
          </Eyebrow>
          <h1 className="text-[24px] font-semibold text-ui-heading">{title}</h1>
          {/* Two segments: the current and done steps are filled in. */}
          <div aria-hidden="true" className="mt-4 grid max-w-xs grid-cols-2 gap-1">
            <span className="h-1 rounded-full bg-ui-primary" />
            <span className={`h-1 rounded-full ${step === 2 ? 'bg-ui-primary' : 'bg-ui-border'}`} />
          </div>
        </div>
      </header>

      <div className="flex-1 bg-ui-band px-4 py-8 sm:px-8">
        <div
          className={
            step === 1 && mode === 'create'
              ? 'mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]'
              : 'mx-auto max-w-3xl'
          }
        >
          {step === 1 && mode === 'create' && <WizardGuide onPreset={change} />}
          <div className="min-w-0">
            <div className="rounded-card border border-ui-border bg-ui-surface p-6 shadow-card">
              {step === 1 ? (
                <DetailsStep
                  draft={draft}
                  errors={errors}
                  onChange={change}
                  onPick={pick}
                  onRemoveDocument={removeDocument}
                  onBusy={(delta) => setReadingCount((n) => n + delta)}
                />
              ) : (
                <PreferencesStep draft={draft} onChange={change} />
              )}
            </div>

            {saveError && (
              <p role="alert" className="mt-4 text-[13px] text-ui-danger">
                {saveError}
              </p>
            )}

            <footer className="mt-6 flex items-center justify-between">
              {step === 1 ? (
                <LinkButton href="/" variant="ghost">
                  Cancel
                </LinkButton>
              ) : (
                <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>
                  Back
                </Button>
              )}
              {step === 1 ? (
                <Button onClick={next} disabled={readingCount > 0}>
                  Next
                </Button>
              ) : (
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? 'Saving…' : mode === 'create' ? 'Create session' : 'Save changes'}
                </Button>
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
