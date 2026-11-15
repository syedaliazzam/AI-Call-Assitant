/**
 * File: apps/web/src/features/answers/AnswerTags.tsx
 * Purpose: The small muted row on an answer card: the question type (a menu: choosing another one
 *          answers again in that shape), the private source tag, and "Just for you" on a private
 *          answer. All of it is for the user only: none of it is copied or exported.
 * Used by: src/features/live/AnswerPanel.tsx, src/features/live/CompactView.tsx,
 *          src/features/review/ConversationSection.tsx, src/features/ask-kite/AskKitePage.tsx
 * Depends on: @kite/shared (PICKABLE_ANSWER_TYPES, ANSWER_TYPE_LABELS, sourceLabel)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */
'use client';

import {
  ANSWER_TYPE_LABELS,
  PICKABLE_ANSWER_TYPES,
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
  /**
   * Footer size (v1.0.2): 12 px and inline, so the tags sit quietly next to the time and the
   * buttons instead of competing with the answer.
   */
  compact?: boolean;
}

/**
 * The tags.
 *
 * @param props See AnswerTagsProps.
 * @returns The row, or nothing when there is no meta yet.
 * Rendered by: AnswerPanel.tsx, CompactView.tsx, ConversationSection.tsx, AskKitePage.tsx
 */
export function AnswerTags({ meta, sessionType, onChangeType, compact }: AnswerTagsProps) {
  if (!meta) return null;
  const size = compact ? 'text-[12px]' : 'text-[13px]';
  return (
    <p
      aria-label="About this answer"
      className={`${compact ? 'inline-flex' : 'flex'} flex-wrap items-center gap-x-1.5 leading-5 text-ui-muted ${size}`}
    >
      {onChangeType ? (
        <select
          aria-label="Question type: choose another to answer again"
          value={meta.type}
          onChange={(event) => onChangeType(event.target.value as AnswerType)}
          className={`max-w-[10rem] border-0 bg-transparent [field-sizing:content] py-0 pr-1 ${size} text-ui-muted hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]`}
        >
          {/* A screenshot's type is shown too, though it cannot be chosen for a spoken question. */}
          {(PICKABLE_ANSWER_TYPES.includes(meta.type)
            ? PICKABLE_ANSWER_TYPES
            : [meta.type, ...PICKABLE_ANSWER_TYPES]
          ).map((type) => (
            <option key={type} value={type}>
              {ANSWER_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      ) : (
        <span>{ANSWER_TYPE_LABELS[meta.type]}</span>
      )}
      <span aria-hidden="true">·</span>
      {/* ADR-0084: a made-up example story is marked in the warning colour, so it is not said as fact. */}
      <span
        aria-label="Source, just for you"
        className={meta.source === 'example' ? 'font-medium text-ui-warning' : undefined}
      >
        {sourceLabel(meta.source, sessionType)}
      </span>
      {meta.target === 'kite' && (
        <>
          <span aria-hidden="true">·</span>
          <span>Just for you</span>
        </>
      )}
    </p>
  );
}
