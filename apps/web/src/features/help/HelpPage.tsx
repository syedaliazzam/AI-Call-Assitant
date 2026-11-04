/**
 * File: apps/web/src/features/help/HelpPage.tsx
 * Purpose: The /help page: the user guide, as readable text (spec S2). React renders the text as text,
 *          so nothing in the guide can become HTML.
 * Used by: app/(app)/help/page.tsx
 * Depends on: src/core/answer/markdown.ts (the Markdown splitter), ./guideText.ts, src/ui/PageShell.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2 Help)
 */
import { inlinePieces, markdownBlocks } from '@/core/answer/markdown';
import { PageShell } from '@/ui/PageShell';
import { USER_GUIDE_MD } from './guideText';

/**
 * One line with its bold and code marks.
 *
 * @param props.text The line.
 * @returns The pieces.
 * Rendered by: HelpPage
 */
function Line({
  text,
}: {
  /** The line. */
  text: string;
}) {
  return inlinePieces(text).map((piece, index) => {
    if (piece.style === 'bold') {
      return (
        <strong key={index} className="font-semibold text-ui-heading">
          {piece.text}
        </strong>
      );
    }
    if (piece.style === 'code') {
      return (
        <code key={index} className="rounded-[4px] bg-ui-subtle px-1 py-0.5 text-[14px]">
          {piece.text}
        </code>
      );
    }
    return <span key={index}>{piece.text}</span>;
  });
}

/**
 * The guide.
 *
 * @returns The page's content.
 * Rendered by: app/(app)/help/page.tsx
 */
export function HelpPage() {
  return (
    <PageShell title="Help">
      <article className="flex flex-col gap-3 text-[15px] leading-relaxed text-ui-text">
        {markdownBlocks(USER_GUIDE_MD).map((block, index) => {
          if (block.kind === 'heading') {
            return (
              <h2 key={index} className="mt-4 text-card-title text-ui-heading first:mt-0">
                {block.text}
              </h2>
            );
          }
          if (block.kind === 'list') {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List
                key={index}
                className={`flex flex-col gap-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {block.items.map((item, at) => (
                  <li key={at}>
                    <Line text={item} />
                  </li>
                ))}
              </List>
            );
          }
          if (block.kind === 'code') {
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-control bg-ui-subtle p-3 text-[14px]"
              >
                <code>{block.text}</code>
              </pre>
            );
          }
          return (
            <p key={index}>
              <Line text={block.text} />
            </p>
          );
        })}
      </article>
    </PageShell>
  );
}
