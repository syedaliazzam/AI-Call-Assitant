/**
 * File: apps/web/src/features/session-setup/SessionWizard.tsx
 * Purpose: The Create / Edit session wizard: step 1 Details (with documents), step 2
 *          Preferences, with Back / Next / Create (or Save). It keeps what was typed when moving
 *          between steps, checks the required fields, reads documents into text on this
 *          computer, and saves the session with its documents in one go.
 * Used by: app/(app)/sessions/new/page.tsx, app/(app)/sessions/[id]/edit/page.tsx
 * Depends on: src/core/storage (sessions, documents, settings, persist),
 *             src/core/documents (extract, limits), ./DetailsStep.tsx, ./PreferencesStep.tsx,
 *             ./draft.ts, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F2, F3), §5 (Create session),
 *               §7.4; day-03-sessions.md Stage 3
 *
 * Session details and document text are the user's content: kept on this device and never
 * logged.
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { extractText } from '@/core/documents/extract';
import { fitsInSession } from '@/core/documents/limits';
import { listDocuments } from '@/core/storage/documents';
import { requestPersistentStorage } from '@/core/storage/persist';
import {
  createSessionWithDocuments,
  getSession,
  updateSessionWithDocuments,
} from '@/core/storage/sessions';
import { getSessionDefaults } from '@/core/storage/settings';
import { Button } from '@/ui/Button';
import { DetailsStep, type DocumentProblem } from './DetailsStep';
import {
  draftChars,
  draftFromSession,
  draftToInput,
  emptyDraft,
  newDocuments,
  validateDetails,
  type SessionDraft,
} from './draft';
import { PreferencesStep } from './PreferencesStep';

/** Props for SessionWizard. */
export interface SessionWizardProps {
  /** 'create' for a new session, 'edit' to change an existing one. */
  mode: 'create' | 'edit';
  /** The session to edit (edit mode only). */
  sessionId?: string;
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
export function SessionWizard({ mode, sessionId }: SessionWizardProps) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>('loading');
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  // The latest draft, for code that runs after an await (state updates are not visible there).
  const draftRef = useRef<SessionDraft | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [showErrors, setShowErrors] = useState(false);
  const [readingCount, setReadingCount] = useState(0);
  const [problems, setProblems] = useState<DocumentProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the starting point: the defaults from Settings (create) or the stored session (edit).
  useEffect(() => {
    let cancelled = false;
    const start =
      mode === 'create'
        ? getSessionDefaults().then(emptyDraft)
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
  }, [mode, sessionId]);

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
   * Shows a problem with a file under the document list.
   *
   * @param message The message (names the file).
   */
  function addProblem(message: string) {
    setProblems((current) => [...current, { key: crypto.randomUUID(), message }]);
  }

  /**
   * Reads files into text, one at a time (each checked against the room the previous ones
   * left), and adds the ones that fit.
   *
   * @param files The chosen or dropped files.
   */
  async function addFiles(files: File[]) {
    setReadingCount((n) => n + files.length);
    for (const file of files) {
      const result = await extractText(file);
      setReadingCount((n) => n - 1);
      const current = draftRef.current;
      if (!current) return;
      if (!result.ok) {
        addProblem(result.error.message);
        continue;
      }
      const fit = fitsInSession(result.document.chars, draftChars(current));
      if (!fit.ok) {
        addProblem(`${file.name}: ${fit.message}`);
        continue;
      }
      const { name, text, chars } = result.document;
      change({
        documents: [...current.documents, { key: crypto.randomUUID(), name, text, chars }],
      });
    }
  }

  /**
   * Removes a document from the draft (a stored one is deleted when the wizard saves).
   *
   * @param key The document's list key.
   */
  function removeDocument(key: string) {
    const current = draftRef.current;
    if (!current) return;
    const document = current.documents.find((d) => d.key === key);
    change({
      documents: current.documents.filter((d) => d.key !== key),
      removedIds: document?.storedId
        ? [...current.removedIds, document.storedId]
        : current.removedIds,
    });
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
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-4 text-sm text-slate-600">
          {load === 'loading' && 'Loading…'}
          {load === 'not-found' &&
            'This session does not exist on this computer. Sessions are saved per browser and per desktop app, so a session created elsewhere does not appear here.'}
          {load === 'failed' &&
            'Kite could not open its local storage. Reload the page to try again.'}
        </p>
        {load !== 'loading' && (
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700">
            Back to Call Sessions
          </Link>
        )}
      </div>
    );
  }

  const errors = showErrors ? validateDetails(draft) : {};
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Step {step} of 2 · {step === 1 ? 'Details' : 'Preferences'}
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        {step === 1 ? (
          <DetailsStep
            draft={draft}
            errors={errors}
            onChange={change}
            onAddFiles={(files) => void addFiles(files)}
            onRemoveDocument={removeDocument}
            readingCount={readingCount}
            problems={problems}
            onDismissProblem={(key) =>
              setProblems((current) => current.filter((problem) => problem.key !== key))
            }
          />
        ) : (
          <PreferencesStep draft={draft} onChange={change} />
        )}
      </div>

      {saveError && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {saveError}
        </p>
      )}

      <footer className="mt-6 flex items-center justify-between">
        {step === 1 ? (
          <Link href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Cancel
          </Link>
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
  );
}
