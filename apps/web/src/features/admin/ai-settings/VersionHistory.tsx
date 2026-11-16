/**
 * File: apps/web/src/features/admin/ai-settings/VersionHistory.tsx
 * Purpose: Admin → AI settings' History for one tab (ADR-0089): every saved version, newest first, with
 *          its number, who saved it and when, its note and badges (Live, Default, Restored, Moved), a
 *          side-by-side comparison with the live version, and one-click Restore, which saves the old text
 *          as a NEW version (nothing is deleted).
 * Used by: src/features/admin/ai-settings/PromptWorkspace.tsx
 * Depends on: React, lucide-react, src/ui (Badge, Button, Modal), ./SideBySideDiff.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useState, useTransition } from 'react';
import { GitCompare, RotateCcw } from 'lucide-react';
import type { AiInstructionBlock } from '@kite/shared';
import type { ToastTone } from '@/ui/Toast';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import {
  formatWhen,
  versionText,
  type BlockView,
  type InstructionsActions,
  type VersionView,
} from './blocks';
import { SideBySideDiff } from './SideBySideDiff';

/** Props for VersionHistory. */
export interface VersionHistoryProps {
  /** The tab. */
  block: AiInstructionBlock;
  /** The tab's state (versions, the one in force, the default prompt). */
  view: BlockView;
  /** Restores a version (app/(app)/admin/ai-settings/actions.ts). */
  restore: InstructionsActions['restore'];
  /** Shows a toast. */
  onToast: (text: string, tone?: ToastTone) => void;
}

/**
 * The history.
 *
 * @param props See VersionHistoryProps.
 * @returns The list and the comparison dialog.
 * Rendered by: PromptWorkspace.tsx
 */
export function VersionHistory({ block, view, restore, onToast }: VersionHistoryProps) {
  const [comparing, setComparing] = useState<VersionView | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const liveText = view.activePrompt ?? view.defaultPrompt;
  const liveVersion = view.versions.find((version) => version.id === view.activeId) ?? null;

  /**
   * Restores a version as a new version in force.
   *
   * @param version The version.
   */
  function restoreVersion(version: VersionView) {
    setRestoring(version.id);
    startTransition(async () => {
      try {
        const result = await restore(block, version.id);
        if (result.ok) {
          onToast(
            `Version ${version.number} restored as a new version. New calls use it.`,
            'success',
          );
          setComparing(null);
        } else onToast(result.error, 'danger');
      } catch {
        onToast('Something went wrong. Please try again.', 'danger');
      } finally {
        setRestoring(null);
      }
    });
  }

  return (
    <section aria-label="History" className="flex flex-col gap-3">
      {view.versions.length === 0 ? (
        <p className="text-[14px] text-ui-muted">
          No saved versions yet: the default prompt is live. Every save, reset and restore adds a
          version here.
        </p>
      ) : (
        <ol className="divide-y divide-ui-border rounded-control border border-ui-border">
          {view.versions.map((version) => {
            const live = version.id === view.activeId;
            return (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                data-testid="version-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ui-heading">
                    Version {version.number}
                    {live && <Badge tone="success">Live</Badge>}
                    {version.prompt === null && <Badge tone="neutral">Default</Badge>}
                    {version.restored && <Badge tone="neutral">Restored</Badge>}
                    {version.legacy && <Badge tone="neutral">Moved from old settings</Badge>}
                  </p>
                  <p className="mt-0.5 text-[13px] text-ui-muted">
                    {version.authorName ?? 'A deleted account'} · {formatWhen(version.createdAt)}
                  </p>
                  {version.note && (
                    <p className="mt-1 text-[13px] text-ui-text">“{version.note}”</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {!live && (
                    <Button variant="secondary" size="sm" onClick={() => setComparing(version)}>
                      <GitCompare aria-hidden="true" size={14} className="mr-1.5" />
                      Compare
                    </Button>
                  )}
                  {!live && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={restoring !== null}
                      onClick={() => restoreVersion(version)}
                    >
                      <RotateCcw aria-hidden="true" size={14} className="mr-1.5" />
                      {restoring === version.id ? 'Restoring…' : 'Restore'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Modal
        open={comparing !== null}
        onClose={() => setComparing(null)}
        title={comparing ? `Version ${comparing.number} compared with the live version` : 'Compare'}
        subtitle="Removed text on the left, added text on the right."
        width={1100}
        // A long prompt scrolls inside a fixed height instead of being cut off (ADR-0087's fix).
        height={780}
        fullScreenOnPhone
        footer={
          comparing ? (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setComparing(null)}>
                Close
              </Button>
              <Button disabled={restoring !== null} onClick={() => restoreVersion(comparing)}>
                {restoring ? 'Restoring…' : `Restore version ${comparing.number}`}
              </Button>
            </div>
          ) : undefined
        }
      >
        {comparing && (
          <SideBySideDiff
            before={versionText(comparing, view.defaultPrompt)}
            after={liveText}
            beforeLabel={`Version ${comparing.number}`}
            afterLabel={
              liveVersion ? `Live: version ${liveVersion.number}` : 'Live: default prompt'
            }
          />
        )}
      </Modal>
    </section>
  );
}
