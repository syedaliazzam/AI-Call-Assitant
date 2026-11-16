/**
 * File: apps/web/src/features/admin/ai-settings/PromptTextEditor.tsx
 * Purpose: The writing editor of Admin → AI settings (ADR-0089): a comfortable editor for a long prompt,
 *          not a raw text box. A transparent textarea sits over a mirror of the same text that colours
 *          headings and bullet marks, marks lines with a lint hint, and highlights search matches. It has
 *          its own undo and redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, and buttons), a find bar (Ctrl+F;
 *          Enter and Shift+Enter move between matches, Escape closes it), optional line numbers, soft
 *          wrap in a readable proportional font, and a character counter.
 * Used by: src/features/admin/ai-settings/PromptWorkspace.tsx
 * Depends on: React, lucide-react, src/core/admin/promptDocument.ts (line kinds, bullet marks, matches),
 *             src/ui/Button.tsx
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 *
 * The mirror and the textarea share every text style (font, size, weight, line height, padding, wrap),
 * so each coloured line sits exactly under its typed line; the mirror never uses bold for that reason.
 * The editor grows with its text, so the page scrolls and the two never drift.
 */
'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Hash, Redo2, Search, Undo2, X } from 'lucide-react';
import { bulletMarkLength, findMatches, lineKind } from '@/core/admin/promptDocument';
import { Button } from '@/ui/Button';

/** Props for PromptTextEditor. */
export interface PromptTextEditorProps {
  /** The editor's accessible name. */
  label: string;
  /** The text. */
  value: string;
  /** Called with the new text on every change (typing, undo, redo). */
  onChange: (value: string) => void;
  /** Most characters allowed (the counter shows it; typing stops there). */
  maxLength: number;
  /** Lines (from 1) that have a lint hint: marked in yellow. */
  hintLines?: ReadonlySet<number>;
  /** The id of the text that describes the editor (the lint hint), for screen readers. */
  describedBy?: string;
}

/** Typing within this many ms of the last change joins the same undo step. */
const UNDO_JOIN_MS = 800;

/** Most undo steps kept. */
const UNDO_LIMIT = 200;

/** The text styles the mirror and the textarea share (any difference would misalign them). */
const TEXT_STYLE =
  'font-sans text-[15px] font-normal leading-[1.7] tracking-normal whitespace-pre-wrap break-words [overflow-wrap:anywhere] [tab-size:4]';

/** The padding both share, without and with the line-number gutter. */
const PADDING = { plain: 'py-4 pl-5 pr-5', numbered: 'py-4 pl-14 pr-5' } as const;

/**
 * Where two texts start to differ (for the caret after an undo or redo).
 *
 * @param a One text.
 * @param b The other.
 * @returns The first index where they differ.
 */
function firstDifference(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

/**
 * One line of the mirror: the bullet mark in the accent colour, search matches highlighted.
 *
 * @param props.text    The line.
 * @param props.start   The line's offset in the whole text.
 * @param props.matches The search matches in the whole text.
 * @param props.current The current match's index, or -1.
 * @param props.currentRef Set on the current match's element (to scroll it into view).
 * @returns The pieces.
 */
function MirrorLine({
  text,
  start,
  matches,
  current,
  currentRef,
}: {
  /** The line. */
  text: string;
  /** Its offset. */
  start: number;
  /** All matches. */
  matches: readonly [number, number][];
  /** The current match. */
  current: number;
  /** Receives the current match's element. */
  currentRef: (element: HTMLElement | null) => void;
}) {
  const end = start + text.length;
  const mark = bulletMarkLength(text);
  // Cut points: the bullet mark's end and every match edge inside this line.
  const cuts = new Set<number>([0, text.length]);
  if (mark > 0) cuts.add(mark);
  const inLine = matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => match[1] > start && match[0] < end);
  for (const { match } of inLine) {
    cuts.add(Math.max(0, match[0] - start));
    cuts.add(Math.min(text.length, match[1] - start));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const hit = inLine.find(({ match }) => match[0] - start <= from && match[1] - start >= to);
    const isCurrent = hit?.index === current;
    const className = [
      from < mark ? 'text-ui-accent' : '',
      hit ? (isCurrent ? 'rounded-[2px] bg-ui-warning/45' : 'rounded-[2px] bg-ui-warning/20') : '',
    ]
      .filter(Boolean)
      .join(' ');
    pieces.push(
      <span key={from} className={className || undefined} ref={isCurrent ? currentRef : undefined}>
        {text.slice(from, to)}
      </span>,
    );
  }
  return <>{pieces}</>;
}

/**
 * The editor.
 *
 * @param props See PromptTextEditorProps.
 * @returns The toolbar, the find bar when open, and the text area over its mirror.
 * Rendered by: PromptWorkspace.tsx
 */
export function PromptTextEditor({
  label,
  value,
  onChange,
  maxLength,
  hintLines,
  describedBy,
}: PromptTextEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const currentMatch = useRef<HTMLElement | null>(null);
  const [numbers, setNumbers] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  // Undo history: earlier texts, and texts undone (for redo).
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const lastPush = useRef(0);
  const lastValue = useRef(value);
  // How many undo and redo steps there are, kept in state so the buttons render from it.
  const [steps, setSteps] = useState({ undo: 0, redo: 0 });
  /** Copies the history sizes into state after a change to the history. */
  const syncSteps = useCallback(
    () => setSteps({ undo: past.current.length, redo: future.current.length }),
    [],
  );
  const findId = useId();

  // A change from outside (Discard, Reset, a restored draft) is one undo step too.
  useEffect(() => {
    if (value === lastValue.current) return;
    past.current = [...past.current, lastValue.current].slice(-UNDO_LIMIT);
    future.current = [];
    lastValue.current = value;
    lastPush.current = 0;
    syncSteps();
  }, [value, syncSteps]);

  /**
   * Sends a new text, recording the undo step.
   *
   * @param next  The new text.
   * @param joinable True for typing (joins the last step when quick).
   */
  const commit = useCallback(
    (next: string, joinable: boolean) => {
      const now = Date.now();
      if (!joinable || now - lastPush.current > UNDO_JOIN_MS) {
        past.current = [...past.current, lastValue.current].slice(-UNDO_LIMIT);
        lastPush.current = now;
      }
      future.current = [];
      lastValue.current = next;
      syncSteps();
      onChange(next);
    },
    [onChange, syncSteps],
  );

  /**
   * Moves one step back (undo) or forward (redo), and puts the caret where the text changed.
   *
   * @param direction 'undo' or 'redo'.
   */
  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      const from = direction === 'undo' ? past.current : future.current;
      const to = direction === 'undo' ? future.current : past.current;
      const target = from.at(-1);
      if (target === undefined) return;
      from.pop();
      to.push(lastValue.current);
      const caret = firstDifference(lastValue.current, target);
      lastValue.current = target;
      lastPush.current = 0;
      syncSteps();
      onChange(target);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(caret, caret);
      });
    },
    [onChange, syncSteps],
  );

  const matches = useMemo(
    () => findMatches(value, findOpen ? query : ''),
    [value, query, findOpen],
  );
  const safeCurrent = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);

  // Keep the current match in view while searching.
  useEffect(() => {
    if (findOpen && safeCurrent >= 0) currentMatch.current?.scrollIntoView({ block: 'center' });
  }, [findOpen, safeCurrent, query]);

  /** Opens the find bar, starting from the selected words when there are some. */
  const openFind = () => {
    const element = area.current;
    const selected =
      element && element.selectionEnd > element.selectionStart
        ? value.slice(element.selectionStart, element.selectionEnd)
        : '';
    if (selected && !selected.includes('\n')) setQuery(selected);
    setFindOpen(true);
    requestAnimationFrame(() => findInput.current?.select());
  };

  /**
   * Closes the find bar and selects the current match in the text.
   */
  const closeFind = () => {
    const match = safeCurrent >= 0 ? matches[safeCurrent] : undefined;
    setFindOpen(false);
    requestAnimationFrame(() => {
      area.current?.focus();
      if (match) area.current?.setSelectionRange(match[0], match[1]);
    });
  };

  /**
   * Moves to the next or previous match.
   *
   * @param delta +1 or -1.
   */
  const move = (delta: number) => {
    if (matches.length === 0) return;
    setCurrent((index) => (index + delta + matches.length) % matches.length);
  };

  const lines = value.split('\n');
  // Where each line starts in the whole text (for the search matches).
  const starts = lines.reduce<number[]>(
    (list, line, index) => [
      ...list,
      index === 0 ? 0 : list[index - 1]! + lines[index - 1]!.length + 1,
    ],
    [],
  );
  const mirror = lines.map((line, index) => {
    const start = starts[index]!;
    const kind = lineKind(line);
    const hinted = hintLines?.has(index + 1) ?? false;
    return (
      <div
        key={index}
        className={[
          'relative',
          kind === 'heading'
            ? 'text-ui-heading [text-decoration:underline_1px] decoration-ui-border underline-offset-[6px]'
            : '',
          kind === 'quote' ? 'text-ui-muted' : '',
          hinted ? 'bg-ui-warning-bg [box-shadow:inset_3px_0_0_var(--color-ui-warning)]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {numbers && (
          <span
            aria-hidden="true"
            className="absolute -left-12 w-9 select-none text-right text-[12px] tabular-nums text-ui-muted"
          >
            {index + 1}
          </span>
        )}
        <MirrorLine
          text={line}
          start={start}
          matches={matches}
          current={safeCurrent}
          currentRef={(element) => {
            currentMatch.current = element;
          }}
        />
        {/* An empty line still takes its height. */}
        {line === '' && '​'}
      </div>
    );
  });

  return (
    <div
      className="flex flex-col"
      onKeyDown={(event) => {
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          openFind();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-ui-border px-3 py-1.5">
        <Button
          size="sm"
          variant="plain"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={steps.undo === 0}
          onClick={() => step('undo')}
        >
          <Undo2 aria-hidden="true" size={15} />
        </Button>
        <Button
          size="sm"
          variant="plain"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={steps.redo === 0}
          onClick={() => step('redo')}
        >
          <Redo2 aria-hidden="true" size={15} />
        </Button>
        <Button
          size="sm"
          variant="plain"
          aria-label="Find"
          title="Find (Ctrl+F)"
          onClick={openFind}
        >
          <Search aria-hidden="true" size={15} />
        </Button>
        <Button
          size="sm"
          variant="plain"
          aria-pressed={numbers}
          aria-label="Line numbers"
          title="Line numbers"
          onClick={() => setNumbers((shown) => !shown)}
        >
          <Hash aria-hidden="true" size={15} />
        </Button>
        <span className="ml-auto text-[12px] tabular-nums text-ui-muted" aria-live="polite">
          {value.length.toLocaleString('en-US')} / {maxLength.toLocaleString('en-US')} characters
        </span>
      </div>
      {findOpen && (
        <div
          role="search"
          className="flex items-center gap-2 border-b border-ui-border bg-ui-subtle px-3 py-1.5"
        >
          <Search aria-hidden="true" size={14} className="text-ui-muted" />
          <input
            ref={findInput}
            id={findId}
            aria-label="Find in prompt"
            value={query}
            placeholder="Find in prompt"
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrent(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                move(event.shiftKey ? -1 : 1);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                closeFind();
              }
            }}
            className="h-7 min-w-0 flex-1 bg-transparent text-[14px] text-ui-text outline-none placeholder:text-ui-muted"
          />
          <span className="text-[12px] tabular-nums text-ui-muted" aria-live="polite">
            {query === ''
              ? ''
              : matches.length === 0
                ? 'No matches'
                : `${safeCurrent + 1} of ${matches.length}`}
          </span>
          <Button size="sm" variant="plain" aria-label="Previous match" onClick={() => move(-1)}>
            <ChevronUp aria-hidden="true" size={15} />
          </Button>
          <Button size="sm" variant="plain" aria-label="Next match" onClick={() => move(1)}>
            <ChevronDown aria-hidden="true" size={15} />
          </Button>
          <Button size="sm" variant="plain" aria-label="Close find" onClick={closeFind}>
            <X aria-hidden="true" size={15} />
          </Button>
        </div>
      )}
      <div className="relative">
        {/* The mirror: decides the height, shows the colours. Hidden from screen readers. */}
        <div
          aria-hidden="true"
          className={`${TEXT_STYLE} ${numbers ? PADDING.numbered : PADDING.plain} min-h-[24rem] text-ui-text`}
        >
          <div className="relative">{mirror}</div>
          {/* A trailing new line still gets a line of height. */}
          {value.endsWith('\n') && <div>{'​'}</div>}
        </div>
        <textarea
          ref={area}
          aria-label={label}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          value={value}
          maxLength={maxLength}
          spellCheck
          wrap="soft"
          onChange={(event) => commit(event.target.value, true)}
          onKeyDown={(event) => {
            const mod = event.ctrlKey || event.metaKey;
            const key = event.key.toLowerCase();
            if (mod && key === 'z') {
              event.preventDefault();
              step(event.shiftKey ? 'redo' : 'undo');
            } else if (mod && key === 'y') {
              event.preventDefault();
              step('redo');
            } else if (event.key === 'Tab' && !event.shiftKey && !mod) {
              // Two spaces, so a nested bullet or an example can be indented without leaving the editor.
              event.preventDefault();
              const element = event.currentTarget;
              const { selectionStart, selectionEnd } = element;
              const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
              if (next.length <= maxLength) {
                commit(next, false);
                requestAnimationFrame(() =>
                  element.setSelectionRange(selectionStart + 2, selectionStart + 2),
                );
              }
            }
          }}
          className={`${TEXT_STYLE} ${numbers ? PADDING.numbered : PADDING.plain} absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-ui-text outline-none selection:bg-ui-accent-tint selection:text-transparent focus-visible:[box-shadow:var(--k-focus)]`}
        />
      </div>
    </div>
  );
}
