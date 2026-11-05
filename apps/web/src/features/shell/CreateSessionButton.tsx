/**
 * File: apps/web/src/features/shell/CreateSessionButton.tsx
 * Purpose: The "Create session" split button (spec S1): the main part opens Create session as an
 *          interview; the ▾ menu opens it with Interview call, Regular call or Mock interview chosen.
 * Used by: src/features/shell/AppHeader.tsx, src/features/dashboard/Dashboard.tsx (empty state)
 * Depends on: next/navigation, lucide-react, src/ui/SplitButton.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1, S3)
 */
'use client';

import { Bot, Briefcase, Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { SplitButton } from '@/ui/SplitButton';

/** The menu's icons: 18 px, in the menu's muted colour. */
const ICON = { size: 18, strokeWidth: 1.75 } as const;

/**
 * The split button.
 *
 * @returns The button and its menu.
 * Rendered by: AppHeader.tsx, Dashboard.tsx
 */
export function CreateSessionButton() {
  const router = useRouter();
  return (
    <SplitButton
      onClick={() => router.push('/sessions/new?type=interview')}
      menuLabel="Choose a session type"
      items={[
        {
          label: 'Interview call',
          icon: <Briefcase {...ICON} />,
          onSelect: () => router.push('/sessions/new?type=interview'),
        },
        {
          label: 'Regular call',
          icon: <Phone {...ICON} />,
          onSelect: () => router.push('/sessions/new?type=regular'),
        },
        {
          label: 'Mock interview',
          icon: <Bot {...ICON} />,
          onSelect: () => router.push('/sessions/new?type=mock'),
        },
      ]}
    >
      Create session
    </SplitButton>
  );
}
