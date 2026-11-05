/**
 * File: apps/web/src/ui/listNavigation.ts
 * Purpose: The rules a select's list follows: which options a search shows, and where the arrow keys
 *          and type-ahead go. Plain functions, so they can be tested without a browser.
 * Used by: src/ui/Select.tsx, src/ui/MultiSelect.tsx
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4, S5)
 */

/** The part of an option these rules read. */
export interface ListOption {
  /** The words shown. */
  label: string;
  /** True when it cannot be chosen; the keys skip it. */
  disabled?: boolean | undefined;
}

/**
 * The options a search shows: those whose label contains the query, ignoring case and outer spaces.
 *
 * @param options The options.
 * @param query   What was typed.
 * @returns The matching options, in the same order.
 * Called from: Select; tests
 */
export function filterOptions<T extends ListOption>(options: readonly T[], query: string): T[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...options];
  return options.filter((option) => option.label.toLowerCase().includes(wanted));
}

/**
 * Where an arrow key goes: the next option that can be chosen, wrapping round the ends.
 *
 * @param options The options showing.
 * @param from    The highlighted index (-1 when none).
 * @param step    1 for down, -1 for up.
 * @returns The new index, or -1 when no option can be chosen.
 * Called from: Select, MultiSelect; tests
 */
export function nextEnabled(options: readonly ListOption[], from: number, step: 1 | -1): number {
  const count = options.length;
  if (count === 0) return -1;
  let at = from === -1 && step === -1 ? 0 : from;
  for (let tried = 0; tried < count; tried += 1) {
    at = (at + step + count) % count;
    if (!options[at]?.disabled) return at;
  }
  return -1;
}

/**
 * Where typing a letter goes when a list has no search box: the next option starting with those
 * letters, looking on from the highlighted one.
 *
 * @param options The options showing.
 * @param from    The highlighted index.
 * @param typed   The letters typed so far.
 * @returns The new index, or -1 when none starts that way.
 * Called from: Select; tests
 */
export function typeAhead(options: readonly ListOption[], from: number, typed: string): number {
  const wanted = typed.toLowerCase();
  const count = options.length;
  for (let tried = 1; tried <= count; tried += 1) {
    const at = (from + tried + count) % count;
    const option = options[at];
    if (option && !option.disabled && option.label.toLowerCase().startsWith(wanted)) return at;
  }
  return -1;
}
