/**
 * File: apps/web/src/features/admin/ai-settings/VersionHistory.tsx
 * Purpose: Admin → AI settings' version history for one block (ADR-0083): each saved version with its
 *          author and time, a word diff against the version in force, and one-click Restore (which
 *          saves the old text as a NEW version; nothing is deleted).
 * Used by: src/features/admin/ai-settings/InstructionsEditor.tsx
 * Depends on: React, src/core/admin/textDiff.ts, src/ui (Button, Modal), ./blocks.ts,
 *             ./blocks.ts (CARD)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useMemo, useState, useTransition } from 'react';
import { History } from 'lucide-react';
import type { AiInstructionBlock } from '@kite/shared';
import { diffWords } from '@/core/admin/textDiff';
import type { ToastTone } from '@/ui/Toast';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { CARD, type InstructionsActions, type VersionView } from './blocks';

/** Props for VersionHistory. */
export interface VersionHistoryProps {
  /** Which block. */
  block: AiInstructionBlock;
  /** Its versions, newest first. */
  versions: readonly VersionView[];
  /** The version in force, or null. */
  activeId: string | null;
  /** The text in force ('' for none). */
  activeText: string;
  /** The restore action. */
  restore: InstructionsActions['restore'];
  /** Shows the page's toast. */
  onToast: (text: string, tone?: ToastTone) => void;
}

/**
 * A save time in the viewer's own time zone, for example "15 Nov 2026, 14:05".
 *
 * @param iso The time (ISO 8601).
 * @returns The text.
 */
function savedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The word diff from a version to the one in force.
 *
 * @param props.before The version's text.
 * @param props.after  The text in force.
 * @returns The diff, with removed words struck through and added ones marked.
 * Rendered by: VersionHistory (in its dialog)
 */
function DiffView({
  before,
  after,
}: {
  /** The version's text. */
  before: string;
  /** The text in force. */
  after: string;
}) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  if (before === after) {
    return (
      <p className="text-[14px] text-ui-muted">This version has the same text as the live one.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-ui-muted">
        <span className="rounded bg-ui-danger-bg px-1 text-ui-danger line-through">Struck</span>{' '}
        words are only in this version;{' '}
        <span className="rounded bg-ui-success-bg px-1 text-ui-success">marked</span> words are only
        in the live version.
      </p>
      <p
        className="whitespace-pre-wrap break-words rounded-control border border-ui-border bg-ui-subtle p-3 text-[14px] leading-relaxed text-ui-text"
        data-testid="version-diff"
      >
        {parts.map((part, index) =>
          part.kind === 'same' ? (
            <span key={index}>{part.text}</span>
          ) : part.kind === 'removed' ? (
            <del key={index} className="rounded bg-ui-danger-bg text-ui-danger">
              {part.text}
            </del>
          ) : (
            <ins key={index} className="rounded bg-ui-success-bg text-ui-success no-underline">
              {part.text}
            </ins>
          ),
        )}
      </p>
    </div>
  );
}

/**
 * The version history of one block.
 *
 * @param props See VersionHistoryProps.
 * @returns The card, and the diff dialog when one is open.
 * Rendered by: InstructionsEditor.tsx
 */
export function VersionHistory({
  block,
  versions,
  activeId,
  activeText,
  restore,
  onToast,
}: VersionHistoryProps) {
  const [viewing, setViewing] = useState<VersionView | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Restores a version (as a new version in force).
   *
   * @param version The version to restore.
   */
  function restoreVersion(version: VersionView) {
    setRestoring(version.id);
    startTransition(async () => {
      try {
        const result = await restore(block, version.id);
        if (result.ok)
          onToast('Restored as a new version. Calls that start from now use it.', 'success');
        else onToast(result.error, 'danger');
      } catch {
        onToast('Something went wrong. Please try again.', 'danger');
      } finally {
        setRestoring(null);
        setViewing(null);
      }
    });
  }

  return (
    <section aria-label="Version history" className={CARD}>
      <div className="flex items-center gap-2">
        <History aria-hidden="true" size={16} strokeWidth={1.75} className="text-ui-muted" />
        <h2 className="text-[18px] font-semibold text-ui-heading">Version history</h2>
      </div>
      {versions.length === 0 ? (
        <p className="mt-2 text-[13px] text-ui-muted">
          No versions yet. The first save starts the history.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-ui-border rounded-control border border-ui-border">
          {versions.map((version) => {
            const live = version.id === activeId;
            return (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                data-testid="version-row"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] text-ui-heading">
                    <span className="tabular-nums">{savedAt(version.createdAt)}</span>
                    {live && (
                      <span className="inline-flex h-5 items-center rounded-full bg-ui-success-bg px-2 text-chip text-ui-success">
                        Live
                      </span>
                    )}
                    {version.restored && (
                      <span className="inline-flex h-5 items-center rounded-full bg-ui-subtle px-2 text-chip text-ui-muted">
                        Restored
                      </span>
                    )}
                    {version.text === '' && (
                      <span className="inline-flex h-5 items-center rounded-full bg-ui-subtle px-2 text-chip text-ui-muted">
                        Empty
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[13px] text-ui-muted">
                    {version.authorName ?? 'A deleted account'} ·{' '}
                    {version.text.length.toLocaleString('en-US')} characters
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setViewing(version)}>
                    {live ? 'View' : 'View diff'}
                  </Button>
                  {!live && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={restoring !== null}
                      onClick={() => restoreVersion(version)}
                    >
                      {restoring === version.id ? 'Restoring…' : 'Restore'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? `Version of ${savedAt(viewing.createdAt)}` : 'Version'}
        subtitle={
          viewing && viewing.id !== activeId ? 'Compared with the live version' : 'The live version'
        }
        width={720}
        footer={
          viewing && viewing.id !== activeId ? (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewing(null)}>
                Close
              </Button>
              <Button disabled={restoring !== null} onClick={() => restoreVersion(viewing)}>
                {restoring ? 'Restoring…' : 'Restore this version'}
              </Button>
            </div>
          ) : undefined
        }
      >
        {viewing &&
          (viewing.id === activeId ? (
            <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ui-text">
              {viewing.text || 'Empty: no company instructions.'}
            </p>
          ) : (
            <DiffView before={viewing.text} after={activeText} />
          ))}
      </Modal>
    </section>
  );
}
