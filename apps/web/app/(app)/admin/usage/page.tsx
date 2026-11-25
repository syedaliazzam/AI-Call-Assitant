/**
 * File: apps/web/app/(app)/admin/usage/page.tsx
 * Purpose: The /admin/usage route (v1.0.2, ADR-0036): the daily limit, the deeper model's switch
 *          (v1.2.0) and each person's AI requests today and over the last 7 days (with how many went to
 *          Groq). ADR-0121: Groq's switch (ADR-0095) is no longer shown: Groq is hidden and its switch stays off. ADR-0099: the Gemini and OpenAI switches and counts too. Counts only,
 *          never text. Kept thin: loads the
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
import { getGeminiEnv, getOpenAIEnv } from '@/server/env';
import { getDeepModelEnabled, getProviderSwitch } from '@/server/modelAccess';
import { DEFAULT_DAILY_LIMIT, getDailyLimit, usageReport } from '@/server/usage';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';
import {
  setDailyLimitAction,
  setDeepModelAction,
  setGeminiModelAction,
  setOpenAIModelAction,
} from './actions';

/**
 * ADR-0099: the hint under the Gemini or OpenAI switch.
 *
 * @param name       The provider's name, as shown.
 * @param keyName    Its key's variable name.
 * @param configured Whether the server has the key (never the key itself).
 * @returns The hint.
 * Called from: AdminUsagePage
 */
function providerHint(name: string, keyName: string, configured: boolean): string {
  return configured
    ? `Only for the accounts in KITE_ANSWER_MODELS_USERS. Live answers, voice questions and screenshots; an answer ${name} cannot start within 4 s is answered by Claude Haiku 5.5. Off: sessions set to it answer with Claude Haiku 5.5. Changes apply within a minute.`
    : `${keyName} is not set on the server, so ${name} is off whatever this says. Sessions set to it answer with Claude Haiku 5.5.`;
}

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
  const [limit, rows, deepModel, gemini, openai] = await Promise.all([
    getDailyLimit(),
    usageReport(7),
    getDeepModelEnabled(),
    getProviderSwitch('gemini'),
    getProviderSwitch('openai'),
  ]);
  return (
    <PageShell
      title="Usage"
      width="lg"
      description="AI requests per person: today and the last 7 days (UTC), with how many went to Groq, Gemini and OpenAI. Counts only."
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
      {/* ADR-0121: no Groq switch: Groq is hidden from every model list, and its switch stays off. */}
      {/* ADR-0099: one switch per provider. */}
      <DeepModelSwitch
        enabled={gemini}
        action={setGeminiModelAction}
        label="Allow Gemini models in sessions"
        hint={providerHint('Gemini', 'GEMINI_API_KEY', getGeminiEnv() !== null)}
      />
      <DeepModelSwitch
        enabled={openai}
        action={setOpenAIModelAction}
        label="Allow OpenAI (GPT) models in sessions"
        hint={providerHint('OpenAI', 'OPENAI_API_KEY', getOpenAIEnv() !== null)}
      />
      <UsageTable rows={rows} limit={limit} />
    </PageShell>
  );
}
