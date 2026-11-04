/**
 * File: apps/web/src/features/admin/DailyLimitForm.tsx
 * Purpose: The Admin → Usage form that sets the daily limit: how many Claude requests each user may
 *          make per day (UTC) before Kite shows the friendly limit message (v1.0.2, ADR-0036).
 * Used by: app/(app)/admin/usage/page.tsx
 * Depends on: src/features/admin/usageTypes.ts, src/ui/Button.tsx, src/ui/Input.tsx
 * Architecture: docs/decisions/ADR-0036-daily-limit-and-usage-counts.md
 */
'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import type { DailyLimitState } from './usageTypes';

/** The form's state before the first submit. */
const INITIAL_STATE: DailyLimitState = { status: 'idle' };

/** Props for DailyLimitForm. */
export interface DailyLimitFormProps {
  /** The limit in force now (shown in the field). */
  limit: number;
  /** The default limit (named in the hint). */
  defaultLimit: number;
  /** The server action that saves a new limit (setDailyLimitAction). */
  action: (previous: DailyLimitState, formData: FormData) => Promise<DailyLimitState>;
}

/**
 * The daily-limit form.
 *
 * @param props See DailyLimitFormProps.
 * @returns The form section.
 * Rendered by: app/(app)/admin/usage/page.tsx
 */
export function DailyLimitForm({ limit, defaultLimit, action }: DailyLimitFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  return (
    <section className="border border-ui-border rounded-card bg-ui-surface shadow-card p-6">
      <h2 className="text-[18px] font-semibold text-ui-heading">Daily limit</h2>
      <p className="mt-1 text-[13px] text-ui-muted">
        Claude requests each person may make per day (answers, chat, screenshots, Ask AI, notes). It
        resets at midnight UTC. Changes apply within a minute.
      </p>
      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <Input
          label="Requests per person per day"
          name="limit"
          type="number"
          inputMode="numeric"
          min={1}
          max={100_000}
          step={1}
          required
          defaultValue={limit}
          hint={`Default ${defaultLimit}.`}
          {...(state.status === 'error' ? { error: state.error } : {})}
          className="w-40"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </form>
      {state.status === 'saved' && (
        <p role="status" className="mt-3 text-[13px] text-ui-success">
          Saved: {state.limit} requests per person per day.
        </p>
      )}
    </section>
  );
}
