/**
 * File: apps/web/src/features/session-setup/KeyTermsInput.tsx
 * Purpose: The wizard's Key terms field (spec S4): names and terms to listen for, as chips. Enter or a
 *          comma makes a chip, a pasted list becomes one chip per term, and Backspace in the empty box
 *          takes the last one away. They become speech-to-text hotwords for the session.
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: @kite/shared (parseKeyTerms), lucide-react, React
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4); docs/architecture/kite-architecture-v3.1.md §5
 */
'use client';

import { parseKeyTerms } from '@kite/shared';
import { X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';

/** Props for KeyTermsInput. */
export interface KeyTermsInputProps {
  /** The terms, as stored: separated by new lines. */
  value: string;
  /** Takes the new terms, one per line. */
  onChange: (value: string) => void;
}

/**
 * The field.
 *
 * @param props See KeyTermsInputProps.
 * @returns The label, the chips and the box.
 * Rendered by: DetailsStep.tsx
 */
export function KeyTermsInput({ value, onChange }: KeyTermsInputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [typing, setTyping] = useState('');
  const terms = parseKeyTerms(value);

  /** Turns what was typed into chips. The shared rule splits, trims and removes duplicates. */
  function commit() {
    if (typing.trim() === '') return;
    onChange(parseKeyTerms([...terms, typing]).join('\n'));
    setTyping('');
  }

  /**
   * Enter and a comma make a chip; Backspace in the empty box takes the last one away.
   *
   * @param event The key press.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && typing === '' && terms.length > 0) {
      onChange(terms.slice(0, -1).join('\n'));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ui-heading">
        Key terms
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-control border border-ui-border bg-ui-input px-2 py-1.5 focus-within:border-ui-link">
        {terms.map((term) => (
          <span
            key={term}
            className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-ui-subtle pr-1 pl-2.5 text-[13px] text-ui-text"
          >
            <span className="truncate">{term}</span>
            <button
              type="button"
              aria-label={`Remove ${term}`}
              onClick={() => onChange(terms.filter((other) => other !== term).join('\n'))}
              className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-ui-control-strong focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
            >
              <X aria-hidden="true" size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={typing}
          aria-describedby={hintId}
          placeholder={terms.length === 0 ? 'People, products, companies' : ''}
          onChange={(event) => setTyping(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          maxLength={5_000}
          className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base text-ui-text placeholder:text-ui-muted focus:outline-none md:text-input"
        />
      </div>
      <p id={hintId} className="text-helper text-ui-muted">
        They help the transcript spell names right.
      </p>
    </div>
  );
}
