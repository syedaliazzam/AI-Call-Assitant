/**
 * File: apps/web/src/features/sync/LegacyUploadCard.tsx
 * Purpose: The one-time question "This computer has N sessions that aren't in your account yet. Add
 *          them to <email>?" (ADR-0049, Phase 4), shown only to an account with account sync, only
 *          when this device's own database holds something, and only until it is done. Add uploads
 *          with progress and ends with "N added, K were already there."; Not now hides it until the
 *          next visit. Nothing is uploaded without the click, because this device's data is not tied
 *          to an account and a shared computer could hold someone else's.
 * Used by: src/features/dashboard/Dashboard.tsx, src/features/home/HomePanel.tsx
 * Depends on: src/core/sync/legacyUpload.ts, src/features/sync/SyncScope.tsx (useSyncAccount),
 *             src/ui (Button, ProgressBar)
 * Architecture: ADR-0049 (migration)
 */
'use client';

import { useEffect, useState } from 'react';
import {
  legacySummary,
  legacyUploadDone,
  markLegacyUploadDone,
  uploadLegacyData,
  type LegacySummary,
  type LegacyUploadResult,
} from '@/core/sync/legacyUpload';
import { Button } from '@/ui/Button';
import { ProgressBar } from '@/ui/ProgressBar';
import { useSyncAccount } from './SyncScope';

/** The sessionStorage key that hides the card after Not now, until the next visit. */
const LATER_KEY = 'kite.legacyUpload.later';

/** What the card shows. */
type CardState =
  | {
      /** Nothing (done, nothing to add, or Not now). */
      step: 'hidden';
    }
  | {
      /** The question. */
      step: 'ask';
      /** What this device holds. */
      summary: LegacySummary;
    }
  | {
      /** Adding, with progress. */
      step: 'uploading';
      /** Sessions done. */
      done: number;
      /** Sessions in all. */
      total: number;
    }
  | {
      /** Finished: the counts. */
      step: 'done';
      /** What was added and what was already there. */
      result: LegacyUploadResult;
    }
  | {
      /** The upload stopped (offline, server error): try again. */
      step: 'failed';
      /** What this device holds. */
      summary: LegacySummary;
    };

/**
 * Whether Not now was chosen in this visit.
 *
 * @returns True to stay hidden.
 */
function hiddenForNow(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The question's words.
 *
 * @param summary What this device holds.
 * @param email   The account.
 * @returns The sentence.
 */
function question(summary: LegacySummary, email: string): string {
  const where = email
    ? ` Add ${summary.sessions > 0 ? 'them' : 'it'} to ${email}?`
    : ' Add it to your account?';
  if (summary.sessions === 0) {
    return `This computer has saved resumes, documents or lessons that aren't in your account yet.${where}`;
  }
  const sessions = summary.sessions === 1 ? '1 session' : `${summary.sessions} sessions`;
  return `This computer has ${sessions} that ${summary.sessions === 1 ? "isn't" : "aren't"} in your account yet.${where}`;
}

/**
 * The one-time upload card.
 *
 * @param props.compact True in the desktop home panel (smaller text and padding).
 * @returns The card, or nothing.
 * Rendered by: Dashboard.tsx, HomePanel.tsx
 */
export function LegacyUploadCard({ compact = false }: { compact?: boolean }) {
  const account = useSyncAccount();
  const [state, setState] = useState<CardState>({ step: 'hidden' });

  useEffect(() => {
    if (!account || legacyUploadDone(account.userId) || hiddenForNow()) return;
    let active = true;
    void legacySummary()
      .then((summary) => {
        if (!active) return;
        // Nothing on this device: never ask.
        if (!summary) markLegacyUploadDone(account.userId);
        else setState({ step: 'ask', summary });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [account]);

  if (!account || state.step === 'hidden') return null;

  /**
   * Uploads, with progress; remembers it is done once every session is in the account.
   *
   * @param summary What this device holds (shown again if the upload fails).
   */
  const add = async (summary: LegacySummary) => {
    setState({ step: 'uploading', done: 0, total: summary.sessions });
    try {
      const result = await uploadLegacyData((done, total) =>
        setState({ step: 'uploading', done, total }),
      );
      if (result.added + result.existing + result.skipped === result.total) {
        markLegacyUploadDone(account.userId);
      }
      setState({ step: 'done', result });
    } catch {
      setState({ step: 'failed', summary });
    }
  };

  /** Hides the card until the next visit. */
  const later = () => {
    try {
      sessionStorage.setItem(LATER_KEY, '1');
    } catch {
      // Storage blocked: it is hidden for this page only.
    }
    setState({ step: 'hidden' });
  };

  const box = compact
    ? 'mx-3 mb-2 rounded-card border border-ui-border bg-ui-surface p-3 text-[13px]'
    : 'mb-4 rounded-card border border-ui-border bg-ui-surface p-4 text-[14px]';

  return (
    <section aria-label="Add this computer's data to your account" className={box}>
      {state.step === 'ask' || state.step === 'failed' ? (
        <>
          <p className="text-ui-text">{question(state.summary, account.email)}</p>
          {state.step === 'failed' && (
            <p role="alert" className="mt-2 text-ui-danger">
              Couldn&apos;t add everything. Check your connection and try again; nothing is added
              twice.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void add(state.summary)}>
              {state.step === 'failed' ? 'Try again' : 'Add'}
            </Button>
            <Button size="sm" variant="ghost" onClick={later}>
              Not now
            </Button>
          </div>
        </>
      ) : state.step === 'uploading' ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-ui-text">
            Adding to your account…{' '}
            {state.total > 0 ? `${state.done} of ${state.total} sessions` : ''}
          </p>
          <ProgressBar
            value={state.total > 0 ? state.done / state.total : 0}
            label="Adding sessions to your account"
          />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3" role="status">
          <p className="text-ui-text">
            {state.result.added} added, {state.result.existing}{' '}
            {state.result.existing === 1 ? 'was' : 'were'} already there.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setState({ step: 'hidden' })}>
            Close
          </Button>
        </div>
      )}
    </section>
  );
}
