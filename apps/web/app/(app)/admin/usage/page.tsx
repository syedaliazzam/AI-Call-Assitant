/**
 * File: apps/web/app/(app)/admin/usage/page.tsx
 * Purpose: The /admin/usage route (v1.0.2, ADR-0036): the daily limit and each person's Claude
 *          requests today and over the last 7 days. Counts only, never text. Kept thin: loads the
 *          data and passes it, with the server action, to the feature UI.
 * Used by: Next.js App Router (admins only, see ../layout.tsx)
 * Depends on: src/server/guard.ts, src/server/usage.ts, src/features/admin (UsageTable,
 *             DailyLimitForm), ./actions.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin); ADR-0036
 */
import { DailyLimitForm } from '@/features/admin/DailyLimitForm';
import { UsageTable } from '@/features/admin/UsageTable';
import { requireAdmin } from '@/server/guard';
import { DEFAULT_DAILY_LIMIT, getDailyLimit, usageReport } from '@/server/usage';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';
import { setDailyLimitAction } from './actions';

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
  const [limit, rows] = await Promise.all([getDailyLimit(), usageReport(7)]);
  return (
    <PageShell
      title="Usage"
      width="lg"
      description="Claude requests per person: today and the last 7 days (UTC). Counts only."
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
      <UsageTable rows={rows} limit={limit} />
    </PageShell>
  );
}
