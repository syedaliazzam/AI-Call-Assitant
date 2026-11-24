/**
 * File: apps/web/src/features/session-setup/SessionWizard.tsx
 * Purpose: The Create / Edit session wizard (spec S4, S5): a modal, about 760 × 600 and full screen on a
 *          phone, with a left rail (title, stepper, View tutorial and Mock presets) and the two steps:
 *          Details, then Preferences. It keeps what was typed when moving between steps, checks the
 *          required fields, asks before throwing typed work away, and saves the session with its own
 *          copy of its documents in one go.
 * Used by: app/(app)/sessions/new/page.tsx, app/(app)/sessions/[id]/edit/page.tsx
 * Depends on: lucide-react, src/core/storage (sessions, documents, settings, persist),
 *             src/core/documents/limits.ts, ./DetailsStep.tsx, ./PreferencesStep.tsx, ./draft.ts,
 *             ./MockPresetsDialog.tsx, src/ui (Button, Dialog, Modal, Stepper, Tooltip)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4, S5), §5;
 *               docs/architecture/kite-architecture-v3.1.md §2 (F2, F3), §5, §7.4
 *
 * Session details and document text are the user's content: kept on this device and never
 * logged.
 */
'use client';

import { Bot, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fitsInSession, overSessionLimit } from '@/core/documents/limits';
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
import { SOON_TOOLTIP } from '@/ui/Chip';
import { Dialog } from '@/ui/Dialog';
import { Modal } from '@/ui/Modal';
import { Stepper } from '@/ui/Stepper';
import { Tooltip } from '@/ui/Tooltip';
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
import { createSessionLabel } from './labels';
import { MockPresetsDialog } from './MockPresetsDialog';
import { PreferencesStep } from './PreferencesStep';

/** Props for SessionWizard. */
export interface SessionWizardProps {
  /** 'create' for a new session, 'edit' to change an existing one. */
  mode: 'create' | 'edit';
  /** The session to edit (edit mode only). */
  sessionId?: string;
  /** The type to start with, from the split button's menu (create mode; anything unknown is ignored). */
  initialType?: string;
}

/** Where loading the wizard's starting point stands. */
type LoadState = 'loading' | 'ready' | 'not-found' | 'failed';

/** The two steps' names, in order. */
const STEPS = ['Details', 'Preferences'] as const;

/**
 * The Create / Edit session wizard.
 *
 * @param props See SessionWizardProps.
 * @returns The modal.
 * Rendered by: app/(app)/sessions/new/page.tsx, app/(app)/sessions/[id]/edit/page.tsx
 */
export function SessionWizard({ mode, sessionId, initialType }: SessionWizardProps) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>('loading');
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  // The latest draft, for code that runs after an await (state updates are not visible there).
  const draftRef = useRef<SessionDraft | null>(null);
  // What the draft started as, to tell whether anything was typed.
  const startRef = useRef('');
  const [step, setStep] = useState<1 | 2>(1);
  const [showErrors, setShowErrors] = useState(false);
  const [readingCount, setReadingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [presets, setPresets] = useState(false);

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
        startRef.current = JSON.stringify(initial);
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

  /** Leaves the wizard for the sessions page. */
  function leave() {
    router.push('/');
  }

  /** Closes the wizard, asking first when something was typed. */
  function close() {
    if (draftRef.current && JSON.stringify(draftRef.current) !== startRef.current) {
      setConfirmingClose(true);
      return;
    }
    leave();
  }

  /** Saves the session (and its documents), then returns to the sessions page. */
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
        // Ask the browser to keep the app's data; the answer only affects eviction under disk
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
      leave();
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
      <Modal
        open
        onClose={leave}
        title={title}
        footer={
          load !== 'loading' && (
            <Button size="lg" onClick={leave}>
              Back to Call Sessions
            </Button>
          )
        }
      >
        {load === 'loading' && 'Loading…'}
        {load === 'not-found' &&
          'This session does not exist on this computer. Sessions are saved per browser and per desktop app, so a session created elsewhere does not appear here.'}
        {load === 'failed' &&
          'Paramount AI could not open its local storage. Reload the page to try again.'}
      </Modal>
    );
  }

  const errors = showErrors ? validateDetails(draft) : {};
  // ADR-0117: over the 500,000-character limit the server would refuse every answer for this
  // session, so the wizard does not go on until documents are removed (step 1 says so).
  const overLimit = overSessionLimit(draftChars(draft));
  return (
    <>
      <Modal
        open
        onClose={close}
        title={title}
        subtitle="Add the call details and choose what the AI can use."
        width={760}
        height={600}
        fullScreenOnPhone
        closeOnBackdrop={false}
        rail={
          <>
            <Stepper steps={STEPS} current={step - 1} />
            <div className="mt-auto flex flex-col gap-2 max-sm:hidden">
              <Tooltip content={SOON_TOOLTIP} className="w-full">
                <Button variant="secondary" disabled className="w-full">
                  <Video aria-hidden="true" size={16} />
                  View tutorial
                </Button>
              </Tooltip>
              <Button variant="secondary" className="w-full" onClick={() => setPresets(true)}>
                <Bot aria-hidden="true" size={16} />
                Mock presets
              </Button>
            </div>
          </>
        }
        footer={
          <>
            {saveError && (
              <p role="alert" className="mr-auto self-center text-helper text-ui-danger">
                {saveError}
              </p>
            )}
            {step === 1 ? (
              <>
                <Button variant="ghost" size="lg" onClick={close}>
                  Cancel
                </Button>
                <Button size="lg" onClick={next} disabled={readingCount > 0 || overLimit}>
                  Next
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="lg" onClick={() => setStep(1)} disabled={saving}>
                  Back
                </Button>
                <Button size="lg" onClick={() => void save()} disabled={saving || overLimit}>
                  {saving
                    ? 'Saving…'
                    : mode === 'create'
                      ? createSessionLabel(draft.type)
                      : 'Save changes'}
                </Button>
              </>
            )}
          </>
        }
      >
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
        <MockPresetsDialog
          open={presets}
          onClose={() => setPresets(false)}
          onPreset={(changes) => {
            change(changes);
            setStep(1);
          }}
        />
        <Dialog
          open={confirmingClose}
          onClose={() => setConfirmingClose(false)}
          title="Discard this session?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmingClose(false)}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={leave}>
                Discard
              </Button>
            </>
          }
        >
          What you typed here will be lost.
        </Dialog>
      </Modal>
    </>
  );
}
