/**
 * File: apps/web/src/features/home/StartSessionCard.tsx
 * Purpose: The desktop window's "Start your session" card (spec S10): a confirmation of what the call
 *          will use (company, role, type, CV, documents, language, model, answer preferences), then
 *          Continue or Back. When the session is not in the desktop app yet, it first asks for the file
 *          the browser saved (spec S9). After an import it offers to delete that file (ticked by
 *          default, the developer's decision), which the shell does when the card is left.
 * Used by: src/features/home/HomePanel.tsx
 * Depends on: lucide-react, src/core/session/handoff.ts, src/core/storage (documents, sessions, types),
 *             src/features/session-setup/labels.ts, src/platform, src/ui
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9, S10); ADR-0045
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { handoffFileName } from '@kite/shared';
import { ArrowLeft, Bot, Briefcase, Check, FileUp, Minus, Phone } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { importHandoff } from '@/core/session/handoff';
import { listDocuments } from '@/core/storage/documents';
import { getSession } from '@/core/storage/sessions';
import {
  ANSWER_LANGUAGES,
  type Session,
  type SessionType,
  type StoredDocument,
} from '@/core/storage/types';
import { MODEL_OPTIONS, SESSION_TYPE_LABELS, styleSummary } from '@/features/session-setup/labels';
import { pullAccountSync } from '@/core/sync/client';
import { useSyncAccount } from '@/features/sync/SyncScope';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';

/** Props for StartSessionCard. */
export interface StartSessionCardProps {
  /** The session the link named. */
  sessionId: string;
  /** Goes on to the call. */
  onContinue: (sessionId: string) => void;
  /** Goes back to the home panel. */
  onBack: () => void;
  /** Opens Create session, for someone without the file. */
  onCreateHere: () => void;
  /** The signed-in account's email, shown as "Signed in as …" with account sync (ADR-0052). */
  email?: string;
}

/** The icon of each session type's chip. */
const TYPE_ICONS: Record<SessionType, typeof Briefcase> = {
  interview: Briefcase,
  regular: Phone,
  mock: Bot,
};

/**
 * Reads a session and its documents from this device.
 *
 * @param sessionId The session.
 * @returns Both, or null when this device does not hold it.
 * Called from: StartSessionCard
 */
async function readSession(
  sessionId: string,
): Promise<{ session: Session; documents: StoredDocument[] } | null> {
  const session = await getSession(sessionId);
  return session ? { session, documents: await listDocuments(sessionId) } : null;
}

/**
 * One row of the summary.
 *
 * @param props.label    What it is.
 * @param props.children Its value.
 * @returns The row.
 * Rendered by: StartSessionCard
 */
function SummaryRow({
  label,
  children,
}: {
  /** What it is. */
  label: string;
  /** Its value. */
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[14px]">
      <dt className="shrink-0 text-ui-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ui-heading">{children}</dd>
    </div>
  );
}

/**
 * The card.
 *
 * @param props See StartSessionCardProps.
 * @returns The file request, or the summary.
 * Rendered by: HomePanel.tsx
 */
export function StartSessionCard({
  sessionId,
  onContinue,
  onBack,
  onCreateHere,
  email,
}: StartSessionCardProps) {
  // ADR-0049/0052: with account sync the session comes from the account, never from a file.
  const synced = useSyncAccount() !== null;
  const [data, setData] = useState<{ session: Session; documents: StoredDocument[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'needs-file' | 'failed'>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The picked file's name, once an import used it; the shell remembers which file it was.
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [deleteFile, setDeleteFile] = useState(true);

  useEffect(() => {
    let cancelled = false;
    readSession(sessionId)
      // A session just made in the browser may not be here yet: ask the account once, then look again.
      .then(async (found) =>
        found || !synced ? found : pullAccountSync().then(() => readSession(sessionId)),
      )
      .then((found) => {
        if (cancelled) return;
        setData(found);
        setState(found ? 'ready' : 'needs-file');
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, synced]);

  /** Lets the person pick the file, and reads it in. */
  async function chooseFile() {
    setBusy(true);
    setProblem(null);
    try {
      const picked = await getPlatform().pickHandoffFile();
      if (!picked) return;
      if (picked.tooLarge) {
        setProblem('This file is too large to be a session file.');
        return;
      }
      const result = await importHandoff(picked.text, sessionId);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setData(await readSession(sessionId));
      setImportedFrom(picked.name);
      setState('ready');
    } catch {
      setProblem('The file could not be read. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Deletes the picked file when the person left the box ticked. Never holds up the next step. */
  function finishImport() {
    if (importedFrom && deleteFile) void getPlatform().deleteHandoffFile();
  }

  const backButton = (
    <Button
      variant="plain"
      onClick={() => {
        finishImport();
        onBack();
      }}
    >
      <ArrowLeft aria-hidden="true" size={16} />
      Back
    </Button>
  );

  if (state === 'loading') return <p className="p-4 text-[14px] text-ui-muted">Loading…</p>;

  if (state === 'failed') {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p role="alert" className="text-[14px] text-ui-danger">
          Paramount AI could not read your sessions on this computer. Reopen it and try again.
        </p>
        {backButton}
      </div>
    );
  }

  if ((state === 'needs-file' || !data) && synced) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-center text-card-title text-ui-heading">Session not found</h1>
        <p role="alert" className="text-[14px] leading-relaxed text-ui-text">
          This session is not in the account this app is signed in to{email ? ` (${email})` : ''}.
          It may have been deleted, or made in another account.
        </p>
        {backButton}
      </div>
    );
  }

  if (state === 'needs-file' || !data) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-center text-card-title text-ui-heading">Bring this session here</h1>
        <p className="text-[14px] leading-relaxed text-ui-text">
          This session was made in your browser, which saved it as{' '}
          <span className="break-all font-medium">{handoffFileName(sessionId)}</span> in your
          downloads. Choose that file to use it here.
        </p>
        {problem && (
          <p role="alert" className="text-[14px] text-ui-danger">
            {problem}
          </p>
        )}
        <Button className="w-full" disabled={busy} onClick={() => void chooseFile()}>
          <FileUp aria-hidden="true" size={16} />
          {busy ? 'Reading…' : 'Choose the file'}
        </Button>
        <Button variant="secondary" className="w-full" onClick={onCreateHere}>
          Create it here instead
        </Button>
        {backButton}
      </div>
    );
  }

  const { session, documents } = data;
  const TypeIcon = TYPE_ICONS[session.type];
  const resume = documents.some((document) => document.kind === 'resume');
  const others = documents.filter((document) => document.kind !== 'resume').length;
  const language =
    ANSWER_LANGUAGES.find((option) => option.value === session.preferences.language)?.label ??
    session.preferences.language;
  const model =
    MODEL_OPTIONS.find((option) => option.value === session.preferences.model)?.label ??
    session.preferences.model;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-center text-card-title text-ui-heading">Start your session</h1>
      {synced && email && (
        <p className="text-center text-[13px] text-ui-muted">Signed in as {email}</p>
      )}
      <section
        aria-label="Session summary"
        className="flex flex-col gap-2 rounded-card bg-ui-panel p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-ui-heading">{session.company}</p>
            <p className="truncate text-card-role text-ui-muted">{session.role}</p>
          </div>
          <Chip icon={<TypeIcon aria-hidden="true" size={14} strokeWidth={1.75} />}>
            {SESSION_TYPE_LABELS[session.type]}
          </Chip>
        </div>
        <dl className="flex flex-col divide-y divide-ui-border">
          <SummaryRow label="CV">
            {resume ? (
              <Check aria-label="Attached" size={16} className="inline text-ui-accent-fill" />
            ) : (
              <Minus aria-label="None" size={16} className="inline text-ui-muted" />
            )}
          </SummaryRow>
          <SummaryRow label="Documents">{others}</SummaryRow>
          <SummaryRow label="Language">{language}</SummaryRow>
          <SummaryRow label="Model">{model}</SummaryRow>
          <SummaryRow label="Answers">{styleSummary(session.preferences.style)}</SummaryRow>
        </dl>
      </section>
      {importedFrom && (
        <label className="flex items-start gap-2 text-[14px] text-ui-text">
          <input
            type="checkbox"
            checked={deleteFile}
            onChange={(event) => setDeleteFile(event.target.checked)}
            className="mt-0.5 size-4 accent-ui-accent-fill"
          />
          <span className="min-w-0 break-words">
            Delete the hand-off file <span className="text-ui-muted">({importedFrom})</span>
          </span>
        </label>
      )}
      <Button
        className="w-full"
        onClick={() => {
          finishImport();
          onContinue(session.id);
        }}
      >
        Continue
      </Button>
      {backButton}
    </div>
  );
}
