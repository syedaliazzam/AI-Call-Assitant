/**
 * File: apps/web/src/features/admin/DeepModelSwitch.tsx
 * Purpose: The Admin → Usage switch that allows or stops sessions using the deeper model (spec §6). With
 *          it off, a session set to that model answers with the fast one. ADR-0095: the same switch, with its
 *          own words, for Groq.
 * Used by: app/(app)/admin/usage/page.tsx
 * Depends on: React, src/ui/Toggle.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §6
 */
'use client';

import { useState, useTransition } from 'react';
import { Toggle } from '@/ui/Toggle';

/** Props for DeepModelSwitch. */
export interface DeepModelSwitchProps {
  /** The state in force now. */
  enabled: boolean;
  /** The server action that saves a change (setDeepModelAction). Resolves to true when saved. */
  action: (enabled: boolean) => Promise<boolean>;
  /** ADR-0095: the switch's words (default: the deeper model's). */
  label?: string;
  /** ADR-0095: the line under it (default: the deeper model's). */
  hint?: string;
}

/**
 * The switch, in its section.
 *
 * @param props See DeepModelSwitchProps.
 * @returns The section.
 * Rendered by: app/(app)/admin/usage/page.tsx
 */
export function DeepModelSwitch({
  enabled,
  action,
  label = 'Allow Claude Sonnet 5.5 in sessions',
  hint = 'It costs about 20 times as much per answer. Off: sessions set to it answer with Claude Haiku 5.5. Changes apply within a minute.',
}: DeepModelSwitchProps) {
  const [on, setOn] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <section className="rounded-card border border-ui-border bg-ui-surface p-6">
      <Toggle
        label={label}
        hint={hint}
        checked={on}
        disabled={pending}
        onChange={(next) => {
          setOn(next);
          setFailed(false);
          startTransition(async () => {
            const saved = await action(next);
            if (!saved) {
              setOn(!next);
              setFailed(true);
            }
          });
        }}
      />
      {failed && (
        <p role="alert" className="mt-3 text-helper text-ui-danger">
          Something went wrong. Please try again.
        </p>
      )}
    </section>
  );
}
