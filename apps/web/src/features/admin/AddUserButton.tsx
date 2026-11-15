/**
 * File: apps/web/src/features/admin/AddUserButton.tsx
 * Purpose: The admin pages' header buttons, in place of "Create session" (spec S1, S17). On Users:
 *          "AI settings" (ADR-0083) and "Usage" (links; icons on a phone) and the primary "Add user",
 *          which opens the page's Add user dialog. On AI settings: "Users" and "Usage" (the dialog
 *          lives on the Users page).
 * Used by: src/features/shell/AppHeader.tsx (on /admin/users and /admin/ai-settings)
 * Depends on: next/navigation, lucide-react, src/ui/Button.tsx, src/ui/LinkButton.tsx, ./addUserSignal.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S1, S17); ADR-0083
 */
'use client';

import { usePathname } from 'next/navigation';
import { ChartColumn, Sparkles, UserPlus, Users } from 'lucide-react';
import { Button } from '@/ui/Button';
import { LinkButton } from '@/ui/LinkButton';
import { requestAddUser } from './addUserSignal';

/** The icons' size and stroke. */
const ICON = { 'aria-hidden': true, size: 16, strokeWidth: 1.75 } as const;

/**
 * The header's buttons on the admin pages.
 *
 * @returns On Users: AI settings, Usage and Add user; on AI settings: Users and Usage.
 * Rendered by: AppHeader.tsx
 */
export function AddUserButton() {
  const onUsers = usePathname() === '/admin/users';
  return (
    <div className="flex items-center gap-2">
      {onUsers ? (
        // ADR-0083: the company AI instructions.
        <LinkButton href="/admin/ai-settings" variant="secondary" size="md" className="gap-2">
          <Sparkles {...ICON} />
          {/* The word only from 640 px: on a phone the header has room for the icon. */}
          <span className="sr-only sm:not-sr-only">AI settings</span>
        </LinkButton>
      ) : (
        <LinkButton href="/admin/users" variant="secondary" size="md" className="gap-2">
          <Users {...ICON} />
          <span className="sr-only sm:not-sr-only">Users</span>
        </LinkButton>
      )}
      <LinkButton href="/admin/usage" variant="secondary" size="md" className="gap-2">
        <ChartColumn {...ICON} />
        <span className="sr-only sm:not-sr-only">Usage</span>
      </LinkButton>
      {onUsers && (
        <Button onClick={requestAddUser} className="gap-2 whitespace-nowrap">
          <UserPlus {...ICON} />
          Add user
        </Button>
      )}
    </div>
  );
}
