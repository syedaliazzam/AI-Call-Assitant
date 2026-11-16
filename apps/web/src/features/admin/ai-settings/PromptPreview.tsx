/**
 * File: apps/web/src/features/admin/ai-settings/PromptPreview.tsx
 * Purpose: Admin → AI settings' Preview (ADR-0089): a global prompt rendered as a readable document, with
 *          headings, bullet lists (nested by indentation), quoted examples, bold, inline code and quoted
 *          words, in a proportional font with a comfortable line height and a readable width.
 * Used by: src/features/admin/ai-settings/PromptWorkspace.tsx, ContractView.tsx
 * Depends on: React, src/core/admin/promptDocument.ts (promptBlocks, inlineRuns)
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 *
 * Every piece is rendered as text: nothing in a prompt can become HTML.
 */
'use client';

import { inlineRuns, promptBlocks, type PromptBlock } from '@/core/admin/promptDocument';

/**
 * One line's inline runs.
 *
 * @param props.text The line.
 * @returns The runs.
 * Rendered by: PromptPreview
 */
export function InlineText({ text }: { /** The line. */ text: string }) {
  return (
    <>
      {inlineRuns(text).map((run, index) =>
        run.style === 'bold' ? (
          <strong key={index} className="font-semibold text-ui-heading">
            {run.text}
          </strong>
        ) : run.style === 'code' ? (
          <code
            key={index}
            className="rounded-[4px] bg-ui-subtle px-1 py-0.5 font-mono text-[0.88em] text-ui-heading"
          >
            {run.text}
          </code>
        ) : run.style === 'quoted' ? (
          <span key={index} className="text-ui-heading">
            {run.text}
          </span>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * One block of the document.
 *
 * @param props.block The block.
 * @returns Its element.
 * Rendered by: PromptPreview
 */
function Block({ block }: { /** The block. */ block: PromptBlock }) {
  if (block.kind === 'heading') {
    const size =
      block.level === 1 ? 'text-[18px]' : block.level === 2 ? 'text-[16px]' : 'text-[15px]';
    return (
      <h3
        className={`${size} mt-7 border-b border-ui-border pb-1.5 font-semibold leading-snug text-ui-heading first:mt-0`}
      >
        <InlineText text={block.text} />
      </h3>
    );
  }
  if (block.kind === 'list') {
    return (
      <ul className="mt-3 flex flex-col gap-1.5">
        {block.items.map((item, index) => (
          <li
            key={index}
            className="relative pl-5 before:absolute before:left-1 before:top-[0.7em] before:size-[5px] before:rounded-full before:bg-ui-accent"
            style={{ marginLeft: `${item.level * 1.25}rem` }}
          >
            <InlineText text={item.text} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'quote') {
    return (
      <blockquote className="mt-3 flex flex-col gap-1.5 rounded-r-control border-l-[3px] border-ui-accent bg-ui-subtle px-4 py-3 text-[14px] text-ui-muted">
        {block.lines.map((line, index) => (
          <p key={index}>
            <InlineText text={line} />
          </p>
        ))}
      </blockquote>
    );
  }
  return (
    <p className="mt-3">
      <InlineText text={block.text} />
    </p>
  );
}

/** Props for PromptPreview. */
export interface PromptPreviewProps {
  /** The prompt. */
  text: string;
  /** Shown when the prompt is empty. */
  emptyText?: string;
}

/**
 * The prompt as a document.
 *
 * @param props See PromptPreviewProps.
 * @returns The document.
 * Rendered by: PromptWorkspace.tsx, ContractView.tsx
 */
export function PromptPreview({
  text,
  emptyText = 'This prompt is empty: only the app contract is sent.',
}: PromptPreviewProps) {
  const blocks = promptBlocks(text);
  return (
    <article className="max-w-[72ch] font-sans text-[15px] leading-[1.75] text-ui-text">
      {blocks.length === 0 ? (
        <p className="text-ui-muted">{emptyText}</p>
      ) : (
        blocks.map((block, index) => <Block key={index} block={block} />)
      )}
    </article>
  );
}
