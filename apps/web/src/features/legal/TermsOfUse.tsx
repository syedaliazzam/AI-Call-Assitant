/**
 * File: apps/web/src/features/legal/TermsOfUse.tsx
 * Purpose: The public terms of use (/terms), in short plain words: who may use Paramount AI, the
 *          recording consent rule (the "Everyone on the call has agreed to be recorded" checkbox), the
 *          acceptable-use notice (the same words as the in-app notice), and whom to contact. Google's
 *          OAuth consent screen links here.
 * Used by: app/terms/page.tsx
 * Depends on: ./LegalPage.tsx, src/features/notices/acceptableUseText.ts
 * Architecture: ADR-0072 (the consent screen needs this page); docs/implementation/v1.1.0-plan.md
 *               (the acceptable-use notice)
 */
import { ACCEPTABLE_USE_TEXT } from '@/features/notices/acceptableUseText';
import { ContactLink, LegalPage, LegalSection } from './LegalPage';

/**
 * The terms of use page.
 *
 * @returns The page.
 * Rendered by: app/terms/page.tsx
 */
export function TermsOfUse() {
  return (
    <LegalPage title="Terms of use">
      <LegalSection title="Who may use Paramount AI">
        <p>
          Paramount AI is for Paramount Intelligence staff and authorised users only. Accounts are
          created by an administrator; please don&apos;t share yours.
        </p>
      </LegalSection>

      <LegalSection title="Recording needs everyone's consent">
        <p>
          Record a call only when everyone on it has agreed. Before recording, Paramount AI asks you
          to confirm this with the &ldquo;Everyone on the call has agreed to be recorded&rdquo;
          checkbox. Recording or transcribing people without their consent may be against the law
          where you or they are.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>The notice shown in the app applies:</p>
        <blockquote className="border-l-2 border-ui-border pl-4 text-ui-muted">
          {ACCEPTABLE_USE_TEXT}
        </blockquote>
        <p>Misuse can lead to your access being removed.</p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms: <ContactLink />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
