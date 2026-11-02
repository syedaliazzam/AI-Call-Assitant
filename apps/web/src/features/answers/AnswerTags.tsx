/**
 * File: apps/web/src/features/answers/AnswerTags.tsx
 * Purpose: The small muted row on an answer card: the question type (a menu: choosing another one
 *          answers again in that shape), the private source tag, and "Just for you" on a private
 *          answer. All of it is for the user only: none of it is copied or exported.
 * Used by: src/features/live/AnswerPanel.tsx, src/features/live/CompactView.tsx,
 *          src/features/review/ConversationSection.tsx, src/features/ask-kite/AskKitePage.tsx
 * Depends on: @kite/shared (ANSWER_TYPES, ANSWER_TYPE_LABELS, sourceLabel)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */
'use client';

import {
  ANSWER_TYPES,
  ANSWER_TYPE_LABELS,
  sourceLabel,
  type AnswerMeta,
  type AnswerType,
} from '@kite/shared';

/** Props for AnswerTags. */
export interface AnswerTagsProps {
  /** What the hidden line said (nothing shows for an answer saved before this existed). */
  meta: AnswerMeta | undefined;
  /** The session's type, for the source tag's words. */
  sessionType?: string;
  /** Answers again in another shape; without it the type is plain text. */
  onChangeType?: (type: AnswerType) => void;
}

/**
 * The tags.
 *
 * @param props See AnswerTagsProps.
 * @returns The row, or nothing when there is no meta yet.
 * Rendered by: AnswerPanel.tsx, CompactView.tsx, ConversationSection.tsx, AskKitePage.tsx
 */
export function AnswerTags({ meta, sessionType, onChangeType }: AnswerTagsProps) {
  if (!meta) return null;
  return (
    <p
      aria-label="About this answer"
      className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-5 text-ui-muted"
    >
      {onChangeType ? (
        <select
          aria-label="Question type: choose another to answer again"
          title="Choose another type to answer again in that shape"
          value={meta.type}
          onChange={(event) => onChangeType(event.target.value as AnswerType)}
          className="max-w-[10rem] border-0 bg-transparent [field-sizing:content] py-0 pr-1 text-[12px] text-ui-muted hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]"
        >
          {ANSWER_TYPES.map((type) => (
            <option key={type} value={type}>
              {ANSWER_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      ) : (
        <span>{ANSWER_TYPE_LABELS[meta.type]}</span>
      )}
      <span aria-hidden="true">·</span>
      <span aria-label="Source, just for you">{sourceLabel(meta.source, sessionType)}</span>
      {meta.target === 'kite' && (
        <>
          <span aria-hidden="true">·</span>
          <span>Just for you</span>
        </>
      )}
    </p>
  );
}
