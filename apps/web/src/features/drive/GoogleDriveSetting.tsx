/**
 * File: apps/web/src/features/drive/GoogleDriveSetting.tsx
 * Purpose: Settings → Google Drive (ADR-0072): Connect Google Drive (Google's consent page, drive.file
 *          only), then the folder picked in Google Picker; "Connected · <folder> ↗", Change folder,
 *          Disconnect (revokes access); the "Save calls to Google Drive" switch; Reconnect when Google
 *          refused the connection; and the "saved" email: its switch, the "Also notify" team list, and
 *          the latest notifications (sent or failed, with Retry), "Send test email" (to the person only),
 *          or "Email not set up". In the desktop app,
 *          Connect, Reconnect and Change folder open this page in the system browser (Google's pages
 *          cannot open in the app); the rest works in place. After Google sends the person back
 *          (?drive=pick) the Picker opens by itself; an error (?drive=error&reason=…) is explained.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/drive/{api,picker,queue,addresses}.ts, src/platform, src/features/drive/*,
 *             src/ui (Button, Toggle, Textarea)
 * Architecture: ADR-0072
 */
'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { parseAddressList } from '@/core/drive/addresses';
import { DriveApiError, driveApi } from '@/core/drive/api';
import { pickDriveFolder } from '@/core/drive/picker';
import { announceDrive } from '@/core/drive/queue';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Textarea';
import { Toggle } from '@/ui/Toggle';
import { DriveNotificationList } from './DriveNotificationList';
import { useDriveStatus } from './useDrive';

/** Words for the reasons the callback can send back. */
const CALLBACK_ERRORS: Readonly<Record<string, string>> = {
  'not-configured': 'Google Drive is not set up on this server yet.',
  'too-many': 'Too many attempts. Wait a minute and try again.',
  'signed-out': 'Sign in to Paramount AI in this browser, then connect again.',
  'state-invalid': 'The connection could not be checked. Start again with Connect Google Drive.',
  'state-expired': 'That took too long. Start again with Connect Google Drive.',
  'state-account':
    'Google sent back a connection started by another Paramount AI account. Start again here.',
  denied: 'Google Drive was not connected (access was not allowed).',
  scope: 'Google did not grant access to Drive files. Connect again and allow it.',
  refused: 'Google refused the connection. Connect again.',
  unavailable: 'Google Drive is not available right now. Try again later.',
  'google-unavailable': 'Google did not answer. Try again shortly.',
};

/**
 * No-op subscription: the platform never changes while the page is open.
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Words for a failed call.
 * @param error What was thrown.
 * @returns The words.
 */
function failureText(error: unknown): string {
  if (error instanceof DriveApiError) return error.message;
  return error instanceof Error && error.message.includes('Picker')
    ? 'Google Picker could not be loaded. Check the connection and try again.'
    : 'Something went wrong. Try again.';
}

/**
 * The section.
 *
 * @returns The controls.
 * Rendered by: Settings.tsx (Section "Google Drive")
 */
export function GoogleDriveSetting() {
  const { status, error, refresh } = useDriveStatus();
  const here = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().driveSetupHere(),
    () => true,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [alsoText, setAlsoText] = useState<string | null>(null);
  const [alsoMessage, setAlsoMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const handled = useRef(false);

  /**
   * Runs an action with the buttons disabled, then reads the status again and tells other windows.
   * @param action The action.
   * @returns When done.
   */
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      announceDrive('changed');
    } catch (failure) {
      setMessage(failureText(failure));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const connect = () => getPlatform().openDriveSetup('/api/google/connect');

  const chooseFolder = () => {
    if (!here) {
      getPlatform().openDriveSetup('/settings?drive=pick#google-drive');
      return;
    }
    void act(async () => {
      const id = await pickDriveFolder(driveApi());
      if (id) await driveApi().setFolder(id);
    });
  };

  // What Google's redirect asked for (?drive=pick or ?drive=error), once the status is known.
  useEffect(() => {
    if (!status || handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const drive = params.get('drive');
    if (!drive) return;
    // The address goes back to plain /settings, so a reload does not repeat it.
    window.history.replaceState(null, '', `${window.location.pathname}#google-drive`);
    // After this effect (not inside it): the actions below change this component's state.
    void Promise.resolve().then(() => {
      if (drive === 'error') {
        setMessage(
          CALLBACK_ERRORS[params.get('reason') ?? ''] ?? 'Google Drive was not connected.',
        );
      } else if (drive === 'pick' && status.status === 'connected') {
        announceDrive('changed');
        if (here) chooseFolder();
      } else if (drive === 'connect' && status.status !== 'connected') {
        connect();
      }
    });
    // chooseFolder and connect only read the platform and the API client; running once is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!status) {
    return <p className="text-[13px] text-ui-muted">{error ?? 'Checking Google Drive…'}</p>;
  }
  if (!status.configured) {
    return (
      <p className="text-[13px] text-ui-muted">
        Google Drive is not set up on this server yet. Ask your admin.
      </p>
    );
  }

  const browserNote = here ? null : (
    <p className="text-[12px] text-ui-muted">Opens in your web browser.</p>
  );
  const messageLine = message && (
    <p role="alert" className="text-[13px] text-ui-danger">
      {message}
    </p>
  );

  if (status.status === 'not-connected') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ui-text">
          Save each call&apos;s recording, transcript and notes to a Google Drive folder you choose,
          after the call ends. Paramount AI can see only that folder and the files it saves there.
        </p>
        <div className="flex flex-col items-start gap-1">
          <Button onClick={connect} disabled={busy}>
            Connect Google Drive
          </Button>
          {browserNote}
        </div>
        {messageLine}
      </div>
    );
  }

  const also = parseAddressList(alsoText ?? status.email.alsoNotify.join(', '));
  return (
    <div className="flex flex-col gap-4">
      {status.status === 'reconnect' && (
        <div className="flex flex-col items-start gap-2 rounded-control border border-ui-border bg-ui-bg p-3">
          <p className="text-[13px] text-ui-text">
            Google Drive needs to be reconnected (access was removed or expired). Calls waiting to
            upload are kept and continue once you reconnect.
          </p>
          <Button onClick={connect} disabled={busy}>
            Reconnect Google Drive
          </Button>
          {browserNote}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[14px] text-ui-text">
          <span className="font-medium text-ui-heading">
            {status.status === 'connected' ? 'Connected' : 'Reconnect needed'}
          </span>
          {' · '}
          {status.folder ? (
            <a
              href={status.folder.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ui-link underline-offset-2 hover:underline"
            >
              {status.folder.name} ↗
            </a>
          ) : (
            <span className="text-ui-muted">No folder chosen</span>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={chooseFolder}
            disabled={busy || status.status !== 'connected'}
          >
            {status.folder ? 'Change folder' : 'Choose folder'}
          </Button>
          {confirmDisconnect ? (
            <>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const out = await driveApi().disconnect();
                    setConfirmDisconnect(false);
                    if (!out.revoked) {
                      setMessage(
                        'Disconnected here. Google could not be reached to remove access; you can remove it in your Google Account.',
                      );
                    }
                  })
                }
              >
                Disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>
      {!status.folder && status.status === 'connected' && (
        <p className="text-[13px] text-ui-muted">
          Choose the folder your calls are saved in{here ? '' : ' (opens in your web browser)'}.
          Shared Drives work too.
        </p>
      )}
      {confirmDisconnect && (
        <p className="text-[13px] text-ui-muted">
          Disconnecting removes Paramount AI&apos;s access to your Drive. Files already saved stay
          in Drive; calls not yet uploaded stay on this device until you connect again.
        </p>
      )}
      {messageLine}

      <Toggle
        label="Save calls to Google Drive"
        hint="After each call: the recording (when one was made), the transcript and the notes, in a folder for the session."
        checked={status.saveEnabled}
        disabled={busy}
        onChange={(saveEnabled) => void act(() => driveApi().saveSettings({ saveEnabled }))}
      />

      <div className="flex flex-col gap-3 border-t border-ui-border pt-4">
        <p className="text-[14px] font-medium text-ui-heading">Email when a call is saved</p>
        {!status.email.configured ? (
          <p className="text-[13px] text-ui-muted">Email not set up.</p>
        ) : (
          <>
            <Toggle
              label="Email me when a call is saved"
              hint="One email per session, with its title, date, length, the saved files' names and the Drive link. Never the transcript or notes."
              checked={status.email.enabled}
              disabled={busy}
              onChange={(emailEnabled) => void act(() => driveApi().saveSettings({ emailEnabled }))}
            />
            <Textarea
              label="Also notify"
              placeholder="name@company.com, teammate@company.com"
              rows={2}
              value={alsoText ?? status.email.alsoNotify.join(', ')}
              onChange={(event) => {
                setAlsoText(event.target.value);
                setAlsoMessage(null);
              }}
            />
            <p className="text-[12px] text-ui-muted">
              People need access to the Drive folder to open the link. A session can name its own
              list (Create or Edit session).
            </p>
            {(also.invalid.length > 0 || also.tooMany) && (
              <p role="alert" className="text-[13px] text-ui-danger">
                {also.invalid.length > 0
                  ? `Not an email address: ${also.invalid.join(', ')}`
                  : 'At most 20 addresses.'}
              </p>
            )}
            {alsoMessage && <p className="text-[13px] text-ui-muted">{alsoMessage}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setTestMessage(null);
                    const out = await driveApi().sendTestEmail();
                    setTestMessage(
                      out.status === 'sent'
                        ? 'Test email sent to your address. Check your inbox (and spam).'
                        : out.reason === 'rejected'
                          ? 'The mail server refused it: check SMTP_USER, SMTP_PASS and NOTIFY_FROM_EMAIL.'
                          : 'The mail server could not be reached: check SMTP_HOST and SMTP_PORT.',
                    );
                  })
                }
              >
                Send test email
              </Button>
              {testMessage && <p className="text-[13px] text-ui-muted">{testMessage}</p>}
            </div>
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || alsoText === null || also.invalid.length > 0 || also.tooMany}
                onClick={() =>
                  void act(async () => {
                    await driveApi().saveSettings({ alsoNotify: also.valid });
                    setAlsoText(null);
                    setAlsoMessage('Saved.');
                  })
                }
              >
                Save list
              </Button>
            </div>
          </>
        )}
        <DriveNotificationList emailConfigured={status.email.configured} />
      </div>
    </div>
  );
}
