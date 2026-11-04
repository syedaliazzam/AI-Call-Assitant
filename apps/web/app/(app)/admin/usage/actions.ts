/**
 * File: apps/web/app/(app)/admin/usage/actions.ts
 * Purpose: Server actions behind Admin → Usage: set the daily limit (v1.0.2, ADR-0036) and the deeper
 *          model's switch (v1.2.0, spec §6). Check the
 *          caller is an admin (layouts do not protect actions), validates with zod, saves through
 *          src/server/usage.ts and returns a result; errors are returned, never thrown to the UI.
 * Used by: app/(app)/admin/usage/page.tsx (passed to DailyLimitForm)
 * Depends on: src/server/guard.ts, src/server/usage.ts, zod
 * Architecture: docs/decisions/ADR-0036-daily-limit-and-usage-counts.md
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { DailyLimitState } from '@/features/admin/usageTypes';
import { requireAdmin } from '@/server/guard';
import { setDeepModelEnabled } from '@/server/modelAccess';
import { DAILY_LIMIT_RANGE, setDailyLimit } from '@/server/usage';

/** The page this action changes; refreshed after a successful change. */
const USAGE_PATH = '/admin/usage';

/** Rules for the limit field: a whole number in the allowed range. */
const limitSchema = z.coerce
  .number('Enter a number.')
  .int('Enter a whole number.')
  .min(DAILY_LIMIT_RANGE.min, `Use at least ${DAILY_LIMIT_RANGE.min}.`)
  .max(DAILY_LIMIT_RANGE.max, `Use at most ${DAILY_LIMIT_RANGE.max}.`);

/**
 * Saves a new daily limit.
 *
 * @param _previous Previous form state (required by useActionState; not used).
 * @param formData  The submitted form: limit.
 * @returns 'saved' with the limit, or 'error' with the message to show.
 * Called from: DailyLimitForm (src/features/admin/DailyLimitForm.tsx) via useActionState
 */
export async function setDailyLimitAction(
  _previous: DailyLimitState,
  formData: FormData,
): Promise<DailyLimitState> {
  const session = await requireAdmin();
  const parsed = limitSchema.safeParse(formData.get('limit'));
  if (!parsed.success) {
    return { status: 'error', error: parsed.error.issues[0]?.message ?? 'Enter a valid number.' };
  }
  try {
    await setDailyLimit(parsed.data);
  } catch (error) {
    // Ids and the error's name only.
    console.error('admin action failed', {
      action: 'setDailyLimit',
      userId: session.user.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { status: 'error', error: 'Something went wrong. Please try again.' };
  }
  console.info('admin: daily limit set', { userId: session.user.id, limit: parsed.data });
  revalidatePath(USAGE_PATH);
  return { status: 'saved', limit: parsed.data };
}

/**
 * Turns the deeper model on or off for sessions.
 *
 * @param enabled The new state.
 * @returns True when saved.
 * Called from: DeepModelSwitch (src/features/admin/DeepModelSwitch.tsx)
 */
export async function setDeepModelAction(enabled: boolean): Promise<boolean> {
  const session = await requireAdmin();
  // A server action's argument comes from the browser: take only a real boolean.
  if (typeof enabled !== 'boolean') return false;
  try {
    await setDeepModelEnabled(enabled);
  } catch (error) {
    // Ids and the error's name only.
    console.error('admin action failed', {
      action: 'setDeepModel',
      userId: session.user.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
  console.info('admin: deep model set', { userId: session.user.id, enabled });
  revalidatePath(USAGE_PATH);
  return true;
}
