/**
 * File: apps/web/src/features/help/HelpPage.tsx
 * Purpose: The /help page: the user guide, as readable text (spec S2). React renders the text as text,
 *          so nothing in the guide can become HTML. ADR-0128: the Hotkeys section is Settings → Hotkeys' own
 *          list (the same rows and keys, with its Mac / Windows switch), where the guide had a hand-written table
 *          that this page could not draw; and on a Mac the keys in bold read as the Mac's (⌃ ⌥ K, not Ctrl+Alt+K).
 *          A client component, because which computer it is is known only in the browser.
 * Used by: app/(app)/help/page.tsx
 * Depends on: src/core/answer/markdown.ts (the Markdown splitter), ./guideText.ts, ./guideKeys.ts, ./SyncHelp.tsx
 *             (account sync, ADR-0049), src/features/settings/HotkeyList.tsx, src/ui/PageShell.tsx,
 *             src/ui/useIsMac.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2 Help); ADR-0128
 */
'use client';

import { inlinePieces, linkPieces, markdownBlocks } from '@/core/answer/markdown';
import { HotkeyList } from '@/features/settings/HotkeyList';
import { PageShell } from '@/ui/PageShell';
import { useIsMac } from '@/ui/useIsMac';
import { guideKeysFor, HOTKEYS_MARKER } from './guideKeys';
import { USER_GUIDE_MD } from './guideText';
import { SyncHelp } from './SyncHelp';

/**
 * A heading's address on the page: its words in lower case, joined by hyphens ("Private" → "private",
 * "Zoom" → "zoom").
 *
 * @param text The heading's words.
 * @returns The id.
 * Called from: HelpPage; tests
 */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Words with their links. A link opens in a new window: in the desktop app that is the system
 * browser, because the app itself never leaves its own address.
 *
 * @param props.text The words.
 * @returns The pieces.
 * Rendered by: Line
 */
function Linked({
  text,
}: {
  /** The words. */
  text: string;
}) {
  return linkPieces(text).map((piece, index) =>
    piece.href ? (
      <a
        key={index}
        href={piece.href}
        target="_blank"
        rel="noreferrer"
        className="text-ui-link underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
      >
        {piece.text}
      </a>
    ) : (
      <span key={index}>{piece.text}</span>
    ),
  );
}

/**
 * One line with its bold and code marks, and its links.
 *
 * @param props.text The line.
 * @param props.mac  True on a Mac (ADR-0128: keys in bold read as the Mac's).
 * @returns The pieces.
 * Rendered by: HelpPage
 */
function Line({
  text,
  mac,
}: {
  /** The line. */
  text: string;
  /** True on a Mac. */
  mac: boolean;
}) {
  return inlinePieces(text).map((piece, index) => {
    if (piece.style === 'bold') {
      return (
        <strong key={index} className="font-semibold text-ui-heading">
          <Linked text={guideKeysFor(piece.text, mac)} />
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
    return <Linked key={index} text={piece.text} />;
  });
}

/**
 * The guide.
 *
 * @returns The page's content.
 * Rendered by: app/(app)/help/page.tsx
 */
export function HelpPage() {
  // ADR-0128: false on the server and until hydration, then this computer's.
  const mac = useIsMac();
  return (
    <PageShell title="Help">
      {/* ADR-0049: how the account's data is kept comes first. */}
      <SyncHelp />
      <article className="flex flex-col gap-3 text-[15px] leading-relaxed text-ui-text">
        {markdownBlocks(USER_GUIDE_MD).map((block, index) => {
          if (block.kind === 'heading') {
            return (
              // Each heading can be linked to: /help#private, /help#zoom (ADR-0055: the Connect card's tips).
              <h2
                key={index}
                id={headingId(block.text)}
                className="mt-4 scroll-mt-4 text-card-title text-ui-heading first:mt-0"
              >
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
                    <Line text={item} mac={mac} />
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
          if (block.text.trim() === HOTKEYS_MARKER) {
            // ADR-0128: Settings → Hotkeys' own list, so Help and Settings never disagree.
            return (
              <section key={index} aria-label="Hotkeys list" data-help-hotkeys="">
                <HotkeyList />
              </section>
            );
          }
          return (
            <p key={index}>
              <Line text={block.text} mac={mac} />
            </p>
          );
        })}
      </article>
    </PageShell>
  );
}
