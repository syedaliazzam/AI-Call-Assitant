/**
 * File: apps/web/src/features/drive/DriveNotificationList.tsx
 * Purpose: Settings → Google Drive → "Recent notifications" (ADR-0072): the last 20 sessions saved to
 *          Drive, each with its date, its folder link and what became of its email (sent, failed with
 *          Retry, off, or not set up). Read from the account, so every device shows the same list.
 * Used by: src/features/drive/GoogleDriveSetting.tsx
 * Depends on: @kite/shared (DriveNotificationItem), src/core/drive/api.ts, src/ui (Badge, Button)
 * Architecture: ADR-0072
 */
'use client';

import type { DriveNotificationItem, DriveNotificationStatus } from '@kite/shared';
import { useCallback, useEffect, useState } from 'react';
import { DriveApiError, driveApi } from '@/core/drive/api';
import { onDriveMessage } from '@/core/drive/queue';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { Button } from '@/ui/Button';

/** How each email state is shown. */
const STATES: Readonly<Record<DriveNotificationStatus, { label: string; tone: BadgeTone }>> = {
  sent: { label: 'Email sent', tone: 'success' },
  failed: { label: 'Email failed', tone: 'danger' },
  off: { label: 'Email off', tone: 'neutral' },
  'not-set-up': { label: 'No email', tone: 'neutral' },
  pending: { label: 'Sending', tone: 'warning' },
};

/** The date and time shown. */
const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The list.
 *
 * @param props.emailConfigured Whether Retry can work (Resend is set up).
 * @returns The list, or nothing when there is none.
 * Rendered by: GoogleDriveSetting.tsx
 */
export function DriveNotificationList({
  emailConfigured,
}: {
  /** Whether Retry can work. */
  emailConfigured: boolean;
}) {
  const [items, setItems] = useState<DriveNotificationItem[] | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The list is set only when the answer arrives (never synchronously inside the effect).
  const load = useCallback(
    () =>
      driveApi()
        .notifications()
        .then(
          (out) => setItems(out.items),
          () => setItems([]),
        ),
    [],
  );
  useEffect(() => {
    driveApi()
      .notifications()
      .then(
        (out) => setItems(out.items),
        () => setItems([]),
      );
    return onDriveMessage(() => void load());
  }, [load]);

  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium text-ui-heading">Recent notifications</p>
      {message && (
        <p role="alert" className="text-[13px] text-ui-danger">
          {message}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-ui-border rounded-control border border-ui-border">
        {items.map((item) => {
          const state = STATES[item.status];
          return (
            <li
              key={item.sessionId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <a
                  href={item.folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-[13px] text-ui-link underline-offset-2 hover:underline"
                >
                  {item.title} ↗
                </a>
                <p className="text-[12px] text-ui-muted">
                  {WHEN.format(item.createdAt)}
                  {item.recipients > 0 && item.status === 'sent'
                    ? ` · ${item.recipients} ${item.recipients === 1 ? 'person' : 'people'}`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={state.tone}>{state.label}</Badge>
                {emailConfigured && (item.status === 'failed' || item.status === 'not-set-up') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={retrying !== null}
                    onClick={async () => {
                      setRetrying(item.sessionId);
                      setMessage(null);
                      try {
                        const out = await driveApi().retryNotification(item.sessionId);
                        if (out.status === 'failed')
                          setMessage('The email failed again. Try later.');
                      } catch (error) {
                        setMessage(
                          error instanceof DriveApiError
                            ? error.message
                            : 'The email could not be sent.',
                        );
                      } finally {
                        setRetrying(null);
                        await load();
                      }
                    }}
                  >
                    {item.status === 'failed' ? 'Retry' : 'Send'}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
