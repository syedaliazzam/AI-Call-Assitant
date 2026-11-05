/**
 * File: apps/web/src/features/profile/ProfileDetails.tsx
 * Purpose: The /profile page: the name and email of the account, a link to change the password, and what
 *          this app is running in (the browser, or which desktop app version).
 * Used by: app/(app)/profile/page.tsx
 * Depends on: React, src/ui (Card, LinkButton, PageShell, Sidebar's runtimeLabel)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2)
 */
'use client';

import { useSyncExternalStore } from 'react';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';
import { runtimeLabel } from '@/ui/Sidebar';

/** Props for ProfileDetails. */
export interface ProfileDetailsProps {
  /** The account's display name. */
  name: string;
  /** The account's sign-in email. */
  email: string;
}

/**
 * Nothing to subscribe to: this does not change while a page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * The page's content.
 *
 * @param props See ProfileDetailsProps.
 * @returns The account's details.
 * Rendered by: app/(app)/profile/page.tsx
 */
export function ProfileDetails({ name, email }: ProfileDetailsProps) {
  // The server cannot know what the page runs in; the browser fills it in after hydration.
  const runtime = useSyncExternalStore(subscribeNever, runtimeLabel, () => '');
  return (
    <PageShell title="Profile">
      <dl className="grid max-w-lg grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-[15px]">
        <dt className="text-ui-muted">Name</dt>
        <dd className="break-words text-ui-heading">{name}</dd>
        <dt className="text-ui-muted">Email</dt>
        <dd className="break-words text-ui-heading">{email}</dd>
        <dt className="text-ui-muted">Running in</dt>
        <dd className="text-ui-heading">{runtime}</dd>
      </dl>
      <div>
        <LinkButton href="/change-password" variant="secondary">
          Change password
        </LinkButton>
      </div>
    </PageShell>
  );
}
