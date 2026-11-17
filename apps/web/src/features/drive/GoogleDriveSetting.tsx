/**
 * File: apps/web/src/features/drive/GoogleDriveSetting.tsx
 * Purpose: Settings → Google Drive (ADR-0074: one company Google account). Everyone sees where calls are
 *          saved ("Company Drive · <folder> ↗" for admins; ADR-0097: "Company Drive · Your folder ↗",
 *          their own folder, for everyone else, with no link until it exists), or that an admin still has
 *          to set it up or reconnect it,
 *          and their own choices: "Save calls to Google Drive", the "saved" email switch, the "Also
 *          notify" team list, "Send test email" (to the person only), and the latest notifications with
 *          Retry (or "Email not set up"). Admins also get "Company Google Drive": Connect (Google's
 *          consent page, drive.file only, while signed in to the company account), Reconnect, Choose or
 *          Change folder (Google Picker, its token from Google's own popup in this browser, never from
 *          Kite) and Disconnect. In the desktop app, Connect, Reconnect and Choose folder open this page
 *          in the system browser (Google's pages cannot open in the app). After Google sends the admin
 *          back, ?drive=pick asks them to choose the folder; ?drive=error&reason=… is explained.
 *          ADR-0077: "Upload N earlier calls" (EarlierCallsUpload.tsx) under "Save calls to Google Drive".
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/drive/{api,picker,queue,addresses}.ts, src/platform, src/features/drive/*,
 *             src/ui (Button, Toggle, Textarea)
 * Architecture: ADR-0074, ADR-0072, ADR-0077
 */
'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DriveMyFolderResponse } from '@kite/shared';
import { parseAddressList } from '@/core/drive/addresses';
import { DriveApiError, driveApi } from '@/core/drive/api';
import { preparePicker, type PreparedPicker } from '@/core/drive/picker';
import { announceDrive, savesToDrive } from '@/core/drive/queue';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Textarea';
import { Toggle } from '@/ui/Toggle';
import { DriveNotificationList } from './DriveNotificationList';
import { EarlierCallsUpload } from './EarlierCallsUpload';
import { useDriveStatus } from './useDrive';

/** Words for the reasons the callback can send back. */
const CALLBACK_ERRORS: Readonly<Record<string, string>> = {
  'not-configured': 'Google Drive is not set up on this server yet.',
  'too-many': 'Too many attempts. Wait a minute and try again.',
  'signed-out': 'Sign in to Paramount AI in this browser, then connect again.',
  'admin-only': 'Only an admin connects the company Google account.',
  'state-invalid': 'The connection could not be checked. Start again with Connect.',
  'state-expired': 'That took too long. Start again with Connect.',
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
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [alsoText, setAlsoText] = useState<string | null>(null);
  const [alsoMessage, setAlsoMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const handled = useRef(false);
  // The Picker, ready before the click (Google's popup must open inside the click itself).
  const picker = useRef<PreparedPicker | null>(null);

  const admin = status?.admin === true;
  const connected = status?.status === 'connected';
  useEffect(() => {
    if (!admin || !connected || !here || picker.current) return;
    let live = true;
    preparePicker(driveApi())
      .then((ready) => {
        if (live) picker.current = ready;
      })
      // Shown when the admin presses Choose folder.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [admin, connected, here]);

  /**
   * Runs an action with the buttons disabled, then reads the status again and tells other windows.
   * @param action The action (started at once, inside the click).
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
      getPlatform().openDriveSetup('/settings?drive=choose#google-drive');
      return;
    }
    const ready = picker.current;
    if (!ready) {
      setMessage('Google Picker is still loading. Try again in a moment.');
      void preparePicker(driveApi())
        .then((prepared) => {
          picker.current = prepared;
        })
        .catch((failure: unknown) => setMessage(failureText(failure)));
      return;
    }
    void act(async () => {
      setNotice(null);
      const id = await ready.pick();
      if (id) await driveApi().setFolder(id);
    });
  };

  // ADR-0097: a non-admin's own folder (null while it is looked up, or when the lookup failed).
  const [ownFolder, setOwnFolder] = useState<DriveMyFolderResponse | null>(null);
  const companyFolderId = status?.folder?.id ?? null;
  useEffect(() => {
    if (admin || !companyFolderId || status?.status !== 'connected') return;
    let live = true;
    driveApi()
      .myFolder()
      .then((found) => {
        if (live) setOwnFolder(found);
      })
      // No link when it cannot be looked up (Google did not answer).
      .catch(() => {
        if (live) setOwnFolder(null);
      });
    return () => {
      live = false;
    };
  }, [admin, companyFolderId, status?.status]);

  // What Google's redirect asked for (?drive=pick or ?drive=error), once the status is known.
  useEffect(() => {
    if (!status || handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const drive = params.get('drive');
    if (!drive) return;
    // The address goes back to plain /settings, so a reload does not repeat it.
    window.history.replaceState(null, '', `${window.location.pathname}#google-drive`);
    // After this effect (not inside it): these change this component's state.
    void Promise.resolve().then(() => {
      if (drive === 'error') {
        setMessage(
          CALLBACK_ERRORS[params.get('reason') ?? ''] ?? 'Google Drive was not connected.',
        );
      } else if ((drive === 'pick' || drive === 'choose') && status.status === 'connected') {
        announceDrive('changed');
        // Google's popup cannot open by itself: the admin presses Choose folder.
        setNotice(
          status.folder
            ? 'Connected. The company folder is kept; Change folder picks another.'
            : 'Connected. Now choose the company folder (Choose folder).',
        );
      }
    });
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

  // The company folder (admins, the company account's own), or "No folder chosen yet".
  const companyFolderLine = status.folder ? (
    <a
      href={status.folder.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ui-link underline-offset-2 hover:underline"
    >
      {status.folder.name} ↗
    </a>
  ) : (
    <span className="text-ui-muted">No folder chosen yet</span>
  );
  // ADR-0097: everyone else sees their own folder (the company folder is not shared with them); no
  // link until it exists, and nothing while it is looked up or when the lookup failed.
  const ownFolderLine =
    admin || !status.folder || !ownFolder ? null : ownFolder.url ? (
      <a
        href={ownFolder.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ui-link underline-offset-2 hover:underline"
      >
        Your folder ↗
      </a>
    ) : (
      <span className="text-ui-muted">Your folder appears after your first saved call</span>
    );

  // Where calls go, for everyone.
  const where =
    status.status === 'not-connected' ? (
      <p className="text-[13px] text-ui-text">
        Google Drive is not set up yet. An admin connects the company Google account; your calls are
        kept on this device until then.
      </p>
    ) : (
      <div className="flex flex-col gap-1">
        <p className="min-w-0 text-[14px] text-ui-text">
          <span className="font-medium text-ui-heading">Company Drive</span>
          {ownFolderLine ? (
            <>
              {' · '}
              {ownFolderLine}
            </>
          ) : admin || !status.folder ? (
            <>
              {' · '}
              {companyFolderLine}
            </>
          ) : null}
        </p>
        {status.status === 'reconnect' && (
          <p className="text-[13px] text-ui-text">
            Google Drive needs an admin to reconnect it. Calls waiting to upload are kept and
            continue afterwards.
          </p>
        )}
        {!status.folder && status.status === 'connected' && !admin && (
          <p className="text-[13px] text-ui-muted">An admin still has to choose the folder.</p>
        )}
      </div>
    );

  // The company account, for admins.
  const companyControls = admin && (
    <div className="flex flex-col gap-3 rounded-control border border-ui-border bg-ui-bg p-3">
      <p className="text-[14px] font-medium text-ui-heading">Company Google Drive (admin)</p>
      {status.status === 'not-connected' ? (
        <>
          <p className="text-[13px] text-ui-text">
            Connect the company Google account that saves everyone&apos;s calls. Sign in to that
            account on Google&apos;s page. Paramount AI can see only the folder you choose and the
            files it saves there; no Google token is ever sent to anyone&apos;s app.
          </p>
          <div className="flex flex-col items-start gap-1">
            <Button onClick={connect} disabled={busy}>
              Connect company Google account
            </Button>
            {browserNote}
          </div>
        </>
      ) : (
        <>
          {status.account && (
            <p className="text-[13px] text-ui-muted">Connected as {status.account}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {status.status === 'reconnect' && (
              <Button onClick={connect} disabled={busy}>
                Reconnect company Google account
              </Button>
            )}
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
                          'Disconnected here. Google could not be reached to remove access; remove it in the company Google Account.',
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
          {browserNote}
          <p className="text-[12px] text-ui-muted">
            Choose the folder while signed in to the company account (Google asks first). A folder
            in a Shared Drive works when the company account is a member of it.
          </p>
          {confirmDisconnect && (
            <p className="text-[13px] text-ui-muted">
              Disconnecting stops saving for everyone. Files already saved stay in Drive; calls not
              yet uploaded stay on each device until the account is connected again.
            </p>
          )}
        </>
      )}
      {notice && <p className="text-[13px] text-ui-text">{notice}</p>}
      {messageLine}
    </div>
  );

  const also = parseAddressList(alsoText ?? status.email.alsoNotify.join(', '));
  return (
    <div className="flex flex-col gap-4">
      {where}
      {companyControls}
      {!admin && messageLine}

      <Toggle
        label="Save calls to Google Drive"
        hint="After each call: the recording (when one was made), the transcript and the notes, in a folder for the session in the company Drive."
        checked={status.saveEnabled}
        disabled={busy}
        onChange={(saveEnabled) => void act(() => driveApi().saveSettings({ saveEnabled }))}
      />
      {/* ADR-0077: calls of this computer that never reached Drive. */}
      <EarlierCallsUpload enabled={savesToDrive(status) && status.folder !== null} />

      <div className="flex flex-col gap-3 border-t border-ui-border pt-4">
        <p className="text-[14px] font-medium text-ui-heading">Email when a call is saved</p>
        {!status.email.configured ? (
          <p className="text-[13px] text-ui-muted">Email not set up.</p>
        ) : (
          <>
            <Toggle
              label="Email me when a call is saved"
              hint="Per call: one email once the transcript and notes are in Drive, and one more when its recording is. Title, date, length, the saved files' names and Drive links; never the transcript or notes."
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
              People need access to the company Drive folder to open the link. A session can name
              its own list (Create or Edit session).
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
