/**
 * File: apps/web/src/features/session-setup/CompanyField.tsx
 * Purpose: The wizard's company field (spec S4, ADR-0048). After two typed characters and a short
 *          pause it shows companies from past sessions, then brands from Brandfetch, with the logo,
 *          name and domain of each. Up, Down, Enter and Esc work. Typing any other name still works,
 *          and a failed search never gets in the way.
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: src/core/companies (brandfetch, suggestions), src/core/storage (companyPrefs, sessions),
 *             src/ui/Input.tsx, src/features/dashboard/CompanyTile.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4);
 *               docs/decisions/ADR-0048-company-suggestions-from-brandfetch.md
 *
 * The typed company is never logged.
 */
'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { brandfetchClientId, searchBrands } from '@/core/companies/brandfetch';
import {
  localCompanies,
  mergeSuggestions,
  MIN_SUGGESTION_CHARS,
  SUGGESTION_DEBOUNCE_MS,
  type CompanySuggestion,
} from '@/core/companies/suggestions';
import { companySuggestionsOn } from '@/core/storage/companyPrefs';
import { listSessions } from '@/core/storage/sessions';
import { CompanyTile } from '@/features/dashboard/CompanyTile';
import { Input } from '@/ui/Input';

/** How long a search may take, in ms, before the local rows are all that is shown. */
const SEARCH_TIME_LIMIT_MS = 4_000;

/** Props for CompanyField. */
export interface CompanyFieldProps {
  /** The company as typed or picked. */
  value: string;
  /** The problem with the field, when there is one. */
  error?: string | undefined;
  /** Called with the new name, and its domain when a row was picked ('' when typed). */
  onChange: (company: string, domain: string) => void;
}

/**
 * The company field with its suggestions.
 *
 * @param props See CompanyFieldProps.
 * @returns The field.
 * Rendered by: DetailsStep.tsx
 */
export function CompanyField({ value, error, onChange }: CompanyFieldProps) {
  const listId = useId();
  const [rows, setRows] = useState<CompanySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [searchFailed, setSearchFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = useRef<AbortController | null>(null);

  /**
   * Cancels the waiting pause and the running search, so that nothing opens afterwards.
   */
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    search.current?.abort();
    search.current = null;
  }

  useEffect(() => cancel, []);

  /**
   * Looks the text up: past sessions at once, then Brandfetch if that is allowed. A newer lookup
   * cancels this one, so an old reply can never replace newer rows.
   *
   * @param text The typed text.
   */
  async function lookUp(text: string) {
    const controller = new AbortController();
    search.current = controller;
    const sessions = await listSessions().catch(() => []);
    if (controller.signal.aborted) return;
    const local = localCompanies(sessions, text);
    setRows(local);
    setHighlight(-1);
    setSearchFailed(false);
    setOpen(true);
    if (!companySuggestionsOn() || !brandfetchClientId() || !navigator.onLine) return;
    const limit = setTimeout(() => controller.abort(), SEARCH_TIME_LIMIT_MS);
    const outcome = await searchBrands(text, controller.signal);
    clearTimeout(limit);
    // Replaced by a newer lookup, or the field was left. A timed-out search is aborted too, but
    // nothing replaced it, so it still says so.
    if (search.current !== controller) return;
    if (outcome.status === 'ok') setRows(mergeSuggestions(local, outcome.brands));
    else setSearchFailed(true);
  }

  /**
   * The user typed: the name is free text again, with no domain, until a row is picked.
   *
   * @param text The field's text.
   */
  function type(text: string) {
    onChange(text, '');
    cancel();
    if (text.trim().length < MIN_SUGGESTION_CHARS) {
      setRows([]);
      setSearchFailed(false);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => void lookUp(text), SUGGESTION_DEBOUNCE_MS);
  }

  /**
   * Fills the field from a row. Only the name and the domain are kept, never the icon's address.
   *
   * @param row The row.
   */
  function pick(row: CompanySuggestion) {
    cancel();
    onChange(row.name, row.domain ?? '');
    setOpen(false);
    setHighlight(-1);
  }

  /**
   * Up, Down, Enter and Esc in the field.
   *
   * @param event The key press.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && open) {
      // Closes only the list: this Esc must not also close the wizard around it.
      event.preventDefault();
      event.stopPropagation();
      cancel();
      setOpen(false);
      return;
    }
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // From no row, Up goes to the last row and Down to the first.
      setHighlight((at) =>
        at === -1 && step === -1 ? rows.length - 1 : (at + step + rows.length) % rows.length,
      );
    } else if (event.key === 'Enter' && open && highlight >= 0) {
      event.preventDefault();
      pick(rows[highlight]!);
    }
  }

  const showList = open && rows.length > 0;
  const showNote = open && searchFailed;
  return (
    <div className="relative">
      <Input
        label="Company"
        value={value}
        error={error}
        placeholder="Company name"
        maxLength={200}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        {...(showList && highlight >= 0
          ? { 'aria-activedescendant': `${listId}-${highlight}` }
          : {})}
        onChange={(event) => type(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          cancel();
          setOpen(false);
        }}
      />
      {(showList || showNote) && (
        <div className="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-control border border-ui-border bg-ui-surface py-1 shadow-card">
          {showList && (
            <ul id={listId} role="listbox" aria-label="Suggestions">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  // Keeps the focus in the field, so picking with the mouse does not close the list first.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(row)}
                  onMouseEnter={() => setHighlight(index)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${index === highlight ? 'bg-ui-subtle' : ''}`}
                >
                  <CompanyTile name={row.name} domain={row.domain} iconUrl={row.iconUrl} />
                  {/* Two lines: in a half-width column, one line would cut the name short. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ui-text">{row.name}</span>
                    {row.domain && (
                      <span className="block truncate text-[13px] text-ui-muted">{row.domain}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {showNote && (
            <p role="status" className="px-3 py-2 text-[13px] text-ui-muted">
              More suggestions aren&rsquo;t available right now. You can keep typing the name.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
