/**
 * File: apps/web/app/(app)/admin/usage/page.tsx
 * Purpose: The /admin/usage route (v1.0.2, ADR-0036): the daily limit, the deeper model's switch
 *          (v1.2.0), Groq's switch (ADR-0095) and each person's AI requests today and over the last 7 days
 *          (with how many went to Groq). Counts only, never text. Kept thin: loads the
 *          data and passes it, with the server action, to the feature UI.
 * Used by: Next.js App Router (admins only, see ../layout.tsx)
 * Depends on: src/server/guard.ts, src/server/usage.ts, src/features/admin (UsageTable,
 *             DailyLimitForm), ./actions.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin); ADR-0036
 */
import { DailyLimitForm } from '@/features/admin/DailyLimitForm';
import { DeepModelSwitch } from '@/features/admin/DeepModelSwitch';
import { UsageTable } from '@/features/admin/UsageTable';
import { requireAdmin } from '@/server/guard';
import { getGroqEnv } from '@/server/env';
import { getDeepModelEnabled, getGroqSwitch } from '@/server/modelAccess';
import { DEFAULT_DAILY_LIMIT, getDailyLimit, usageReport } from '@/server/usage';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';
import { setDailyLimitAction, setDeepModelAction, setGroqModelAction } from './actions';

/** Next.js route setting: always show today's counts, never a cached page. */
export const dynamic = 'force-dynamic';

/**
 * Admin usage page.
 *
 * @returns The limit form and the usage table.
 */
export default async function AdminUsagePage() {
  // The layout already checked; cached per request.
  await requireAdmin();
  const [limit, rows, deepModel, groq] = await Promise.all([
    getDailyLimit(),
    usageReport(7),
    getDeepModelEnabled(),
    getGroqSwitch(),
  ]);
  // ADR-0095: whether the server has a Groq key at all (never the key itself).
  const groqConfigured = getGroqEnv() !== null;
  return (
    <PageShell
      title="Usage"
      width="lg"
      description="AI requests per person: today and the last 7 days (UTC), with how many went to Groq. Counts only."
      actions={
        <LinkButton href="/admin/users" variant="secondary">
          Users
        </LinkButton>
      }
    >
      <DailyLimitForm
        limit={limit}
        defaultLimit={DEFAULT_DAILY_LIMIT}
        action={setDailyLimitAction}
      />
      <DeepModelSwitch enabled={deepModel} action={setDeepModelAction} />
      <DeepModelSwitch
        enabled={groq}
        action={setGroqModelAction}
        label="Allow Groq (Fastest) in sessions"
        hint={
          groqConfigured
            ? 'Live answers only; screenshots stay on Claude, and an answer Groq cannot start within 4 s is answered by Claude Haiku 5.5. Off: sessions set to it answer with Claude Haiku 5.5. Changes apply within a minute.'
            : 'GROQ_API_KEY is not set on the server, so Groq is off whatever this says. Sessions set to it answer with Claude Haiku 5.5.'
        }
      />
      <UsageTable rows={rows} limit={limit} />
    </PageShell>
  );
}
