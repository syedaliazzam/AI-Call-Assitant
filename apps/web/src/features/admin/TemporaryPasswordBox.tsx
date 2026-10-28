/**
 * File: apps/web/src/features/admin/TemporaryPasswordBox.tsx
 * Purpose: Shows a newly generated temporary password once, with a Copy button, so the admin
 *          can pass it to the person. The password is not stored anywhere and cannot be shown again.
 * Used by: src/features/admin/CreateUserForm.tsx, src/features/admin/UsersTable.tsx
 * Depends on: src/ui/Button.tsx, browser Clipboard API
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2
 */
'use client';

import { useState } from 'react';
import { Button } from '@/ui/Button';

/** Props for TemporaryPasswordBox. */
export interface TemporaryPasswordBoxProps {
  /** Email of the account the password belongs to. */
  email: string;
  /** The temporary password. */
  password: string;
  /** Called when the admin closes the box. */
  onDismiss?: () => void;
}

/**
 * A highlighted box with the email, the password in monospace and a Copy button.
 *
 * @param props See TemporaryPasswordBoxProps.
 * @returns The box element.
 * Rendered by: CreateUserForm.tsx (new account), UsersTable.tsx (password reset)
 */
export function TemporaryPasswordBox({ email, password, onDismiss }: TemporaryPasswordBoxProps) {
  const [copied, setCopied] = useState(false);

  /** Copies the password to the clipboard and briefly shows "Copied". */
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the password is still visible to copy by hand.
      setCopied(false);
    }
  }

  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-medium text-amber-900">Temporary password for {email}</p>
      <p className="mt-1 text-amber-800">
        Share it with the person directly. It is shown only once; they must change it when they
        first sign in.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded border border-amber-300 bg-white px-3 py-1.5 font-mono text-base tracking-wider text-slate-900 select-all">
          {password}
        </code>
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
