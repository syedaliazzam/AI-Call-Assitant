/**
 * File: apps/web/src/features/admin/AddUserButton.tsx
 * Purpose: The Users page's header buttons, in place of "Create session" (spec S1, S17): "Usage" (a
 *          link to Admin → Usage; an icon on a phone) and the primary "Add user", which opens the
 *          page's Add user dialog.
 * Used by: src/features/shell/AppHeader.tsx (on /admin/users)
 * Depends on: lucide-react, src/ui/Button.tsx, src/ui/LinkButton.tsx, ./addUserSignal.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S1, S17)
 */
'use client';

import { ChartColumn, UserPlus } from 'lucide-react';
import { Button } from '@/ui/Button';
import { LinkButton } from '@/ui/LinkButton';
import { requestAddUser } from './addUserSignal';

/**
 * The header's buttons on the Users page.
 *
 * @returns Usage and Add user.
 * Rendered by: AppHeader.tsx
 */
export function AddUserButton() {
  return (
    <div className="flex items-center gap-2">
      <LinkButton href="/admin/usage" variant="secondary" size="md" className="gap-2">
        <ChartColumn aria-hidden="true" size={16} strokeWidth={1.75} />
        {/* The word only from 640 px: on a phone the header has room for the icon. */}
        <span className="sr-only sm:not-sr-only">Usage</span>
      </LinkButton>
      <Button onClick={requestAddUser} className="gap-2 whitespace-nowrap">
        <UserPlus aria-hidden="true" size={16} strokeWidth={1.75} />
        Add user
      </Button>
    </div>
  );
}
