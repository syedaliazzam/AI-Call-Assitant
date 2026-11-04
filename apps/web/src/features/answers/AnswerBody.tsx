/**
 * File: apps/web/src/features/answers/AnswerBody.tsx
 * Purpose: Shows an answer's text, as it streams, the same way everywhere: for the call, the answer
 *          line, bullets, code blocks with Copy, what to say, the tip and the private note, with
 *          anything the claim check could not find underlined and a private "check before saying"
 *          line; for a private (Ask Kite) answer, paragraphs, lists and code blocks.
 * Used by: src/features/live/AnswerPanel.tsx, src/features/live/CompactView.tsx,
 *          src/features/review/ConversationSection.tsx, src/features/ask-kite/AskKitePage.tsx
 * Depends on: src/core/answer (format.ts, markdown.ts, claimCheck.ts), @kite/shared (AnswerTarget)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * Answer text is rendered as text, never as HTML, so nothing in an answer can become markup. It is
 * only rendered (and copied when the user asks); never logged.
 */
'use client';

import type { AnswerTarget } from '@kite/shared';
import { useState } from 'react';
import { claimSegments } from '@/core/answer/claimCheck';
import { splitAnswer } from '@/core/answer/format';
import { inlinePieces, markdownBlocks } from '@/core/answer/markdown';

/**
 * Text sizes for each place an answer is shown. v1.0.2: during a call the answer line is 19 px bold
 * and the bullets 15–16 px, so the words to say stand out from everything around them.
 */
const SIZES = {
  panel: { headline: 'text-[19px] font-bold', body: 'text-[15px]', small: 'text-[13px]' },
  overlay: { headline: 'text-[19px] font-bold', body: 'text-[16px]', small: 'text-[13px]' },
  review: { headline: 'text-[13px]', body: 'text-[13px]', small: 'text-[13px]' },
  chat: { headline: 'text-[15px]', body: 'text-[15px]', small: 'text-[13px]' },
} as const;

/** Why a claim is underlined. */
const CLAIM_TITLE = 'Not found in your documents or the call. Check before saying.';

/** Props for AnswerBody. */
export interface AnswerBodyProps {
  /** The answer's text so far. */
  text: string;
  /** True when no more text will come (v1.1.0): a short one-line answer can then be cut too. */
  finished?: boolean;
  /** Who it is for; 'kite' shows it as a private answer. Absent: for the call. */
  target?: AnswerTarget;
  /** Words the claim check could not find; each is underlined. */
  claims?: readonly string[];
  /** Where it is shown (sets the text sizes). */
  size: keyof typeof SIZES;
  /** The screen-reader name of the answer line (tests and assistive tools read it). */
  headlineLabel?: string;
  /**
   * Starts the answer line with a bold "Answer:" (v1.0.3, reference card): the words to say first
   * are marked as such. For the call only; a private answer has no answer line.
   */
  answerLabel?: boolean;
  /** Hides the placeholder before the first word (a failed answer has its own message). */
  hideEmptyHeadline?: boolean;
  /** Puts text on the clipboard (tests pass a fake). */
  copy?: (text: string) => Promise<void>;
}

/**
 * A line with its claims underlined.
 *
 * @param props.text   The line.
 * @param props.claims The words to underline.
 * @returns The line.
 * Rendered by: AnswerBody
 */
function ClaimText({
  text,
  claims,
}: {
  /** The line. */
  text: string;
  /** The words to underline. */
  claims: readonly string[];
}) {
  return (
    <>
      {claimSegments(text, claims).map((segment, i) =>
        segment.claim ? (
          <span
            key={i}
            data-claim
            title={CLAIM_TITLE}
            className="underline decoration-ui-warning decoration-dotted decoration-2 underline-offset-2"
          >
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A code block with its own Copy button.
 *
 * @param props.language The language it names ('' when none).
 * @param props.text     The code.
 * @param props.copy     Puts text on the clipboard.
 * @returns The block.
 * Rendered by: AnswerBody
 */
function CodeBlock({
  language,
  text,
  copy,
}: {
  /** The language it names. */
  language: string;
  /** The code. */
  text: string;
  /** Puts text on the clipboard. */
  copy: (text: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="mt-2 border border-ui-border bg-ui-band">
      <figcaption className="flex items-center justify-between gap-2 border-b border-ui-border px-2 py-0.5 text-[13px] text-ui-muted">
        <span>{language || 'code'}</span>
        <button
          type="button"
          className="px-1 py-0.5 font-sans font-semibold hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]"
          onClick={() => {
            void copy(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </figcaption>
      {/* tabIndex: a keyboard user can scroll long lines. */}
      <pre tabIndex={0} className="overflow-x-auto p-2 text-[13px] leading-5 text-ui-text">
        <code>{text}</code>
      </pre>
    </figure>
  );
}

/**
 * A private answer's line, with its bold and inline code.
 *
 * @param props.text The line.
 * @returns The line.
 * Rendered by: PrivateAnswer
 */
function InlineText({
  text,
}: {
  /** The line. */
  text: string;
}) {
  return (
    <>
      {inlinePieces(text).map((piece, i) =>
        piece.style === 'bold' ? (
          <strong key={i} className="font-semibold text-ui-heading">
            {piece.text}
          </strong>
        ) : piece.style === 'code' ? (
          <code key={i} className="rounded-control bg-ui-band px-1 text-[0.9em]">
            {piece.text}
          </code>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A private answer: free in shape, read by the user and not said.
 *
 * @param props See AnswerBodyProps.
 * @param props.copyText Puts text on the clipboard.
 * @returns The blocks.
 * Rendered by: AnswerBody
 */
function PrivateAnswer({
  text,
  size,
  copyText,
}: Pick<AnswerBodyProps, 'text' | 'size'> & {
  /** Puts text on the clipboard. */
  copyText: (text: string) => Promise<void>;
}) {
  const sizes = SIZES[size];
  return (
    <div
      aria-label="Private answer"
      className={`flex flex-col gap-2 leading-relaxed ${sizes.body}`}
    >
      {markdownBlocks(text).map((block, i) => {
        if (block.kind === 'code') {
          return <CodeBlock key={i} language={block.language} text={block.text} copy={copyText} />;
        }
        if (block.kind === 'heading') {
          return (
            <h3 key={i} className={`font-semibold text-ui-heading ${sizes.headline}`}>
              <InlineText text={block.text} />
            </h3>
          );
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List
              key={i}
              className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((item, j) => (
                <li key={j}>
                  <InlineText text={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            <InlineText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

/**
 * An answer's text.
 *
 * @param props See AnswerBodyProps.
 * @returns The answer.
 * Rendered by: AnswerPanel.tsx, CompactView.tsx, ConversationSection.tsx, AskKitePage.tsx
 */
export function AnswerBody(props: AnswerBodyProps) {
  const { text, size, claims = [] } = props;
  const copy = props.copy ?? ((value: string) => navigator.clipboard.writeText(value));
  const sizes = SIZES[size];
  if (props.target === 'kite') {
    return text.trim() ? (
      <PrivateAnswer text={text} size={size} copyText={copy} />
    ) : (
      <p className={`text-ui-muted ${sizes.body}`}>…</p>
    );
  }
  const { headline, bullets, keySteps, code, complexity, say, tip, note } = splitAnswer(
    text,
    props.finished ?? false,
  );
  return (
    <>
      {!(props.hideEmptyHeadline && !headline) && (
        <h2
          aria-label={props.headlineLabel ?? 'Answer headline'}
          className={`font-semibold leading-snug text-ui-heading [text-wrap:pretty] ${sizes.headline}`}
        >
          {props.answerLabel && <span className="mr-1.5 font-extrabold">Answer:</span>}
          {headline ? <ClaimText text={headline} claims={claims} /> : '…'}
        </h2>
      )}
      {keySteps && bullets.length > 0 && (
        <p className={`mt-2 font-semibold text-ui-heading ${sizes.body}`}>Key steps</p>
      )}
      {bullets.length > 0 && (
        <ul
          aria-label="Answer details"
          className={`mt-2 list-disc space-y-1 pl-5 leading-snug text-ui-text marker:text-ui-muted ${sizes.body}`}
        >
          {bullets.map((bullet, i) => (
            <li key={i}>
              <ClaimText text={bullet} claims={claims} />
            </li>
          ))}
        </ul>
      )}
      {code.map((block, i) => (
        <CodeBlock key={i} language={block.language} text={block.text} copy={copy} />
      ))}
      {complexity && (
        <p aria-label="Complexity" className={`mt-2 leading-relaxed text-ui-text ${sizes.body}`}>
          <span className="mr-1 font-semibold text-ui-heading">Complexity:</span>
          <ClaimText text={complexity} claims={claims} />
        </p>
      )}
      {say && (
        <p aria-label="How to say it" className={`mt-2 leading-relaxed text-ui-text ${sizes.body}`}>
          <ClaimText text={say} claims={claims} />
        </p>
      )}
      {tip && (
        // Its own subtle line: optional extra depth, so it must not compete with the answer.
        <p aria-label="Tip" className={`mt-2.5 leading-relaxed text-ui-muted ${sizes.body}`}>
          <span className="mr-1 font-medium">Tip:</span>
          <ClaimText text={tip} claims={claims} />
        </p>
      )}
      {note && (
        // For the user only, not to be said: set apart and muted.
        <p
          aria-label="Private note"
          className={`mt-2 border-t border-ui-border pt-1.5 italic text-ui-muted ${sizes.small}`}
        >
          <span className="mr-1 text-[13px] font-medium not-italic">Just for you</span>
          {note}
        </p>
      )}
      {claims.length > 0 && (
        <p aria-label="Check before saying" className={`mt-2 text-ui-muted ${sizes.small}`}>
          <span className="mr-1 text-[13px] font-medium text-ui-warning">Check before saying</span>
          {claims.join(', ')}: not found in your documents or the call.
        </p>
      )}
    </>
  );
}
