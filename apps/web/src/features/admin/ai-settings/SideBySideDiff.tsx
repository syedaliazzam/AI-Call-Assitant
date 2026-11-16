/**
 * File: apps/web/src/features/admin/ai-settings/SideBySideDiff.tsx
 * Purpose: Admin → AI settings' version comparison (ADR-0089): two prompts side by side, line by line,
 *          with unchanged lines plain, removed lines red on the left, added lines green on the right, and
 *          the changed words of an edited line marked inside it. Proportional font and soft wrap, so a
 *          long rule reads as a sentence. Long unchanged runs fold, so it opens on what changed. On a
 *          phone the two sides stack.
 * Used by: src/features/admin/ai-settings/VersionHistory.tsx
 * Depends on: React, src/core/admin/textDiff.ts (diffLines)
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useMemo, useState } from 'react';
import { diffLines, type DiffRow } from '@/core/admin/textDiff';

/** Props for SideBySideDiff. */
export interface SideBySideDiffProps {
  /** The older text (left). */
  before: string;
  /** The newer text (right). */
  after: string;
  /** The left column's heading. */
  beforeLabel: string;
  /** The right column's heading. */
  afterLabel: string;
}

/**
 * One side of a row.
 *
 * @param props.row  The row.
 * @param props.side 'left' or 'right'.
 * @returns The cell.
 * Rendered by: SideBySideDiff
 */
function Cell({
  row,
  side,
}: {
  /** The row. */ row: DiffRow;
  /** Which side. */ side: 'left' | 'right';
}) {
  const text = side === 'left' ? row.left : row.right;
  const number = side === 'left' ? row.leftNumber : row.rightNumber;
  const tone =
    text === null
      ? 'bg-ui-subtle/60'
      : row.kind === 'same'
        ? ''
        : side === 'left'
          ? 'bg-ui-danger-bg'
          : 'bg-ui-success-bg';
  return (
    <div className={`flex min-w-0 gap-3 px-3 py-0.5 ${tone}`}>
      <span className="w-7 shrink-0 select-none text-right text-[11px] leading-[1.7] tabular-nums text-ui-muted">
        {number ?? ''}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-ui-text [overflow-wrap:anywhere]">
        {text === null
          ? ''
          : row.kind === 'changed' && row.words
            ? row.words
                .filter(
                  (part) =>
                    part.kind === 'same' || part.kind === (side === 'left' ? 'removed' : 'added'),
                )
                .map((part, index) =>
                  part.kind === 'same' ? (
                    <span key={index}>{part.text}</span>
                  ) : side === 'left' ? (
                    <del
                      key={index}
                      className="rounded-[2px] bg-ui-danger/20 text-ui-danger decoration-ui-danger"
                    >
                      {part.text}
                    </del>
                  ) : (
                    <ins
                      key={index}
                      className="rounded-[2px] bg-ui-success/20 text-ui-success no-underline"
                    >
                      {part.text}
                    </ins>
                  ),
                )
            : text || '​'}
      </span>
    </div>
  );
}

/** Unchanged lines kept around each change; longer unchanged runs fold. */
const CONTEXT = 3;

/** What the table shows: a row, or a fold of unchanged rows. */
export type DiffItem =
  | {
      /** A row. */
      kind: 'row';
      /** The row. */
      row: DiffRow;
      /** Its index in the rows. */
      index: number;
    }
  | {
      /** A fold of unchanged rows. */
      kind: 'fold';
      /** The first folded row's index. */
      from: number;
      /** How many rows it hides. */
      count: number;
    };

/**
 * Folds long runs of unchanged rows, keeping CONTEXT rows next to each change, so the comparison opens
 * on what changed.
 *
 * @param rows     The rows.
 * @param expanded The folds (by first row index) the admin opened.
 * @returns The items to show.
 * Called from: SideBySideDiff; tests
 */
export function foldUnchanged(rows: readonly DiffRow[], expanded: ReadonlySet<number>): DiffItem[] {
  const items: DiffItem[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.kind !== 'same') {
      items.push({ kind: 'row', row: rows[i]!, index: i });
      i += 1;
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end]!.kind === 'same') end += 1;
    const keepBefore = i === 0 ? 0 : CONTEXT;
    const keepAfter = end === rows.length ? 0 : CONTEXT;
    const hidden = end - i - keepBefore - keepAfter;
    if (hidden > 1 && !expanded.has(i + keepBefore)) {
      for (let k = i; k < i + keepBefore; k += 1)
        items.push({ kind: 'row', row: rows[k]!, index: k });
      items.push({ kind: 'fold', from: i + keepBefore, count: hidden });
      for (let k = end - keepAfter; k < end; k += 1)
        items.push({ kind: 'row', row: rows[k]!, index: k });
    } else {
      for (let k = i; k < end; k += 1) items.push({ kind: 'row', row: rows[k]!, index: k });
    }
    i = end;
  }
  return items;
}

/**
 * The comparison.
 *
 * @param props See SideBySideDiffProps.
 * @returns The two columns (long unchanged runs folded), or a line saying the texts are the same.
 * Rendered by: VersionHistory.tsx
 */
export function SideBySideDiff({ before, after, beforeLabel, afterLabel }: SideBySideDiffProps) {
  const rows = useMemo(() => diffLines(before, after), [before, after]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const changes = rows.filter((row) => row.kind !== 'same').length;
  if (changes === 0) {
    return <p className="text-[14px] text-ui-muted">These two versions are the same.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-ui-muted">
        {changes} changed {changes === 1 ? 'line' : 'lines'}
      </p>
      <div className="overflow-hidden rounded-control border border-ui-border font-sans">
        <div className="grid grid-cols-1 border-b border-ui-border bg-ui-subtle text-[13px] font-medium text-ui-heading sm:grid-cols-2">
          <div className="px-3 py-2">{beforeLabel}</div>
          <div className="hidden border-l border-ui-border px-3 py-2 sm:block">{afterLabel}</div>
        </div>
        <div>
          {foldUnchanged(rows, expanded).map((item) =>
            item.kind === 'fold' ? (
              <button
                key={`fold-${item.from}`}
                type="button"
                onClick={() => setExpanded((current) => new Set(current).add(item.from))}
                className="block w-full border-y border-ui-border bg-ui-subtle/60 px-3 py-1.5 text-center text-[12px] text-ui-muted hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
              >
                Show {item.count} unchanged lines
              </button>
            ) : (
              <div key={item.index} className="grid grid-cols-1 sm:grid-cols-2">
                <Cell row={item.row} side="left" />
                <div className="sm:border-l sm:border-ui-border">
                  <Cell row={item.row} side="right" />
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
