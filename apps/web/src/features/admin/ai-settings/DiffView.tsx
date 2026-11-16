/**
 * File: apps/web/src/features/admin/ai-settings/DiffView.tsx
 * Purpose: Admin → AI settings' word diff between two texts (ADR-0083): words only in the older text
 *          struck through, words only in the newer one marked. Used for a version against the live one,
 *          and (ADR-0087) for the built-in rules a custom prompt was written against against today's.
 * Used by: src/features/admin/ai-settings/VersionHistory.tsx, BuiltInChangeNotice.tsx
 * Depends on: React, src/core/admin/textDiff.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0087-built-in-rules-change-notice.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { diffWords } from '@/core/admin/textDiff';

/** Props for DiffView. */
export interface DiffViewProps {
  /** The older text. */
  before: string;
  /** The newer text. */
  after: string;
  /** What the struck words are, for example "only in this version". */
  beforeLabel: string;
  /** What the marked words are, for example "only in the live version". */
  afterLabel: string;
  /** Shown when the texts are equal. */
  sameText: string;
}

/**
 * The word diff from `before` to `after`.
 *
 * @param props See DiffViewProps.
 * @returns The legend and the diff, or sameText when equal.
 * Rendered by: VersionHistory.tsx, BuiltInChangeNotice.tsx (in their dialogs)
 */
export function DiffView({ before, after, beforeLabel, afterLabel, sameText }: DiffViewProps) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const body = useRef<HTMLParagraphElement>(null);
  // A long prompt may change only far down: open the dialog at the first change, not at its top or end.
  useEffect(() => {
    // One frame later: this effect runs before the Modal's own (a child's effects run first), so the
    // dialog is opened, and has moved focus, only after it.
    const frame = requestAnimationFrame(() =>
      body.current?.querySelector('del, ins')?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [parts]);
  if (before === after) return <p className="text-[14px] text-ui-muted">{sameText}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-ui-muted">
        <span className="rounded bg-ui-danger-bg px-1 text-ui-danger line-through">Struck</span>{' '}
        words are {beforeLabel};{' '}
        <span className="rounded bg-ui-success-bg px-1 text-ui-success">marked</span> words are{' '}
        {afterLabel}.
      </p>
      <p
        ref={body}
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
