/**
 * File: apps/web/src/features/auth/SignOutButton.tsx
 * Purpose: Button that signs out this device and returns to /login.
 * Used by: app/(app)/layout.tsx (sidebar user box), app/change-password/page.tsx
 * Depends on: src/core/auth/authClient.ts, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '@/core/auth/authClient';
import { Button } from '@/ui/Button';

/**
 * Sign-out button: signs out this device and returns to /login.
 *
 * @returns A small ghost-style button.
 * Rendered by: app/(app)/layout.tsx (sidebar user box), app/change-password/page.tsx
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  /** Deletes this device's session, then shows the sign-in page. */
  async function handleClick() {
    setPending(true);
    await signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
