/**
 * File: apps/web/src/features/admin/ai-settings/VersionHistory.tsx
 * Purpose: Admin → AI settings' version history for one block (ADR-0083), in two modes (ADR-0086):
 *          'text' lists the changes to the instructions (simple mode), 'prompt' the changes to the full
 *          system prompt (advanced mode). Each entry shows its author and time, a word diff against the
 *          one in force, and one-click Restore, which saves that instructions text or prompt as a NEW
 *          version (the other part stays as it is; nothing is deleted).
 * Used by: src/features/admin/ai-settings/InstructionsEditor.tsx, PromptEditor.tsx
 * Depends on: React, src/ui (Button, Modal), ./blocks.ts, ./DiffView.tsx
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0086-full-system-prompt-editing.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useMemo, useState, useTransition } from 'react';
import { History } from 'lucide-react';
import type { AiInstructionBlock, CustomPrompt } from '@kite/shared';
import type { ToastTone } from '@/ui/Toast';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import {
  builtInPrompt,
  CARD,
  effectivePromptKey,
  promptAsText,
  type InstructionsActions,
  type LockedView,
  type VersionView,
} from './blocks';
import { DiffView } from './DiffView';

/** Props for VersionHistory. */
export interface VersionHistoryProps {
  /** Which block. */
  block: AiInstructionBlock;
  /** 'text': the instructions' changes; 'prompt': the full prompt's changes. */
  mode: 'text' | 'prompt';
  /** Its versions, newest first. */
  versions: readonly VersionView[];
  /** The version in force, or null. */
  activeId: string | null;
  /** The instructions in force ('' for none). */
  activeText: string;
  /** The custom prompt in force, or null for the built-in prompt. */
  activePrompt: CustomPrompt | null;
  /** The built-in prompt's parts. */
  locked: readonly LockedView[];
  /** The restore action. */
  restore: InstructionsActions['restore'];
  /** Shows the page's toast. */
  onToast: (text: string, tone?: ToastTone) => void;
}

/** One entry of the list: a version that changed the part this mode shows. */
interface Entry {
  /** The version. */
  version: VersionView;
  /** Its text as compared (the instructions, or the whole prompt under part titles). */
  shown: string;
  /** True when it is the same as the one in force (no restore). */
  live: boolean;
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
 * A small rounded label.
 *
 * @param props.tone     'success' (Live) or 'muted'.
 * @param props.children The words.
 * @returns The badge.
 */
function Badge({
  tone,
  children,
}: {
  /** The colour. */
  tone: 'success' | 'muted';
  /** The words. */
  children: string;
}) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-chip ${
        tone === 'success' ? 'bg-ui-success-bg text-ui-success' : 'bg-ui-subtle text-ui-muted'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The version history of one block, for its instructions or its full prompt.
 *
 * @param props See VersionHistoryProps.
 * @returns The card, and the diff dialog when one is open.
 * Rendered by: InstructionsEditor.tsx, PromptEditor.tsx
 */
export function VersionHistory({
  block,
  mode,
  versions,
  activeId,
  activeText,
  activePrompt,
  locked,
  restore,
  onToast,
}: VersionHistoryProps) {
  const [viewing, setViewing] = useState<Entry | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const builtIn = useMemo(() => builtInPrompt(locked), [locked]);

  // What this mode compares, for the version in force.
  const liveShown = mode === 'text' ? activeText : promptAsText(block, activePrompt ?? builtIn);

  // Only the versions that changed this part: each run of equal versions shows its oldest (where the
  // change was made), so a save of the other part does not fill the list.
  const entries = useMemo((): Entry[] => {
    const keyOf = (version: VersionView) =>
      mode === 'text' ? version.text : effectivePromptKey(block, version.prompt, builtIn);
    const liveKey = mode === 'text' ? activeText : effectivePromptKey(block, activePrompt, builtIn);
    const list: Entry[] = [];
    versions.forEach((version, index) => {
      const older = versions[index + 1];
      if (older && keyOf(older) === keyOf(version)) return;
      list.push({
        version,
        shown: mode === 'text' ? version.text : promptAsText(block, version.prompt ?? builtIn),
        live: list.length === 0 && keyOf(version) === liveKey && activeId !== null,
      });
    });
    return list;
  }, [versions, mode, block, builtIn, activeText, activePrompt, activeId]);

  /**
   * Restores an entry (as a new version in force).
   *
   * @param entry The entry to restore.
   */
  function restoreEntry(entry: Entry) {
    setRestoring(entry.version.id);
    startTransition(async () => {
      try {
        const result = await restore(block, entry.version.id, mode);
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

  const title = mode === 'text' ? 'Version history' : 'Prompt history';

  return (
    <section aria-label={title} className={CARD}>
      <div className="flex items-center gap-2">
        <History aria-hidden="true" size={16} strokeWidth={1.75} className="text-ui-muted" />
        <h2 className="text-[18px] font-semibold text-ui-heading">{title}</h2>
      </div>
      {entries.length === 0 ? (
        <p className="mt-2 text-[13px] text-ui-muted">
          No versions yet. The first save starts the history.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-ui-border rounded-control border border-ui-border">
          {entries.map((entry) => {
            const { version, live } = entry;
            return (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                data-testid="version-row"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] text-ui-heading">
                    <span className="tabular-nums">{savedAt(version.createdAt)}</span>
                    {live && <Badge tone="success">Live</Badge>}
                    {version.restored && <Badge tone="muted">Restored</Badge>}
                    {mode === 'text' && version.text === '' && <Badge tone="muted">Empty</Badge>}
                    {mode === 'prompt' && (
                      <Badge tone="muted">{version.prompt ? 'Custom' : 'Built-in'}</Badge>
                    )}
                  </p>
                  <p className="truncate text-[13px] text-ui-muted">
                    {version.authorName ?? 'A deleted account'} ·{' '}
                    {(mode === 'text'
                      ? version.text.length
                      : Object.values(version.prompt ?? builtIn).reduce(
                          (sum, part) => sum + (part ?? '').length,
                          0,
                        )
                    ).toLocaleString('en-US')}{' '}
                    characters
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setViewing(entry)}>
                    {live ? 'View' : 'View diff'}
                  </Button>
                  {!live && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={restoring !== null}
                      onClick={() => restoreEntry(entry)}
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
        title={viewing ? `Version of ${savedAt(viewing.version.createdAt)}` : 'Version'}
        subtitle={viewing && !viewing.live ? 'Compared with the live version' : 'The live version'}
        width={720}
        // A full prompt is long: a fixed height lets it scroll instead of being cut off (ADR-0087).
        {...(mode === 'prompt' ? { height: 760 } : {})}
        footer={
          viewing && !viewing.live ? (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewing(null)}>
                Close
              </Button>
              <Button disabled={restoring !== null} onClick={() => restoreEntry(viewing)}>
                {restoring ? 'Restoring…' : 'Restore this version'}
              </Button>
            </div>
          ) : undefined
        }
      >
        {viewing &&
          (viewing.live ? (
            <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ui-text">
              {viewing.shown || 'Empty: no company instructions.'}
            </p>
          ) : (
            <DiffView
              before={viewing.shown}
              after={liveShown}
              beforeLabel="only in this version"
              afterLabel="only in the live version"
              sameText="This version has the same text as the live one."
            />
          ))}
      </Modal>
    </section>
  );
}
