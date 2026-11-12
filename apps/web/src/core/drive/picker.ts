/**
 * File: apps/web/src/core/drive/picker.ts
 * Purpose: Opens Google Picker for an admin to choose the company Drive folder calls are saved in
 *          (ADR-0074; ADR-0072 before it): folders only, My Drive and Shared Drives, with
 *          setSelectFolderEnabled and setAppId (the project number), so the picked folder is granted to
 *          Kite's drive.file access for the company account. The Picker's token comes from Google
 *          Identity Services' popup in this browser (signed in as the company account), never from
 *          Kite's server, and is used for the Picker only. Loads Google's scripts before the click.
 *          Runs in a browser only: the desktop app opens Settings in the system browser for this.
 * Used by: src/features/drive/GoogleDriveSetting.tsx
 * Depends on: Google's https://apis.google.com/js/api.js and https://accounts.google.com/gsi/client
 *             (loaded here), src/core/drive/api.ts
 * Architecture: ADR-0074, ADR-0072
 */
import { DRIVE_FOLDER_MIME } from '@kite/shared';
import type { DriveApi } from './api';

/** Google's loader script (the Picker). */
const GAPI_SRC = 'https://apis.google.com/js/api.js';

/** Google Identity Services (the Picker's own token, in this browser only). */
const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** The only scope asked for: files Kite makes and folders picked for it. */
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** The part of a Picker view used here. */
interface PickerView {
  /** Shows folders. */
  setIncludeFolders(on: boolean): PickerView;
  /** Lets a folder be picked. */
  setSelectFolderEnabled(on: boolean): PickerView;
  /** Only these types. */
  setMimeTypes(types: string): PickerView;
  /** Shows Shared Drives instead of My Drive. */
  setEnableDrives(on: boolean): PickerView;
  /** Opens inside this folder. */
  setParent?(id: string): PickerView;
}

/** The part of the Picker builder used here. */
interface PickerBuilder {
  /** Adds a view. */
  addView(view: PickerView): PickerBuilder;
  /** Turns on a feature. */
  enableFeature(feature: string): PickerBuilder;
  /** The access token. */
  setOAuthToken(token: string): PickerBuilder;
  /** The API key. */
  setDeveloperKey(key: string): PickerBuilder;
  /** The project number. */
  setAppId(id: string): PickerBuilder;
  /** The dialog's title. */
  setTitle(title: string): PickerBuilder;
  /** Where the result goes. */
  setCallback(callback: (data: PickerResult) => void): PickerBuilder;
  /** Makes the picker. */
  build(): { setVisible(on: boolean): void };
}

/** What the Picker reports. */
interface PickerResult {
  /** 'picked', 'cancel' or 'loaded'. */
  action: string;
  /** The picked items. */
  docs?: { id: string }[];
}

/** The part of Google's picker namespace used here. */
interface PickerNamespace {
  /** View constructor. */
  DocsView: new (viewId: string) => PickerView;
  /** Builder constructor. */
  PickerBuilder: new () => PickerBuilder;
  /** View ids. */
  ViewId: {
    /** The folders view. */
    FOLDERS: string;
  };
  /** Features. */
  Feature: {
    /** Shared Drives. */
    SUPPORT_DRIVES: string;
  };
  /** Actions. */
  Action: {
    /** Something was picked. */
    PICKED: string;
    /** The dialog was closed. */
    CANCEL: string;
  };
}

/** What Google Identity Services' token popup answers. */
interface TokenResponse {
  /** The short-lived access token, when the admin allowed it. */
  access_token?: string;
  /** Why not (for example 'access_denied'). */
  error?: string;
}

/** Google Identity Services' token client. */
interface TokenClient {
  /**
   * Opens Google's popup. Must run inside the click that asked for it, or the browser blocks it.
   * @param overrides prompt '' reuses an earlier consent.
   */
  requestAccessToken(overrides?: { prompt?: string }): void;
}

/** The part of Google Identity Services used here. */
interface IdentityNamespace {
  /**
   * Makes a token client.
   * @param config The client id, scope, account hint and callbacks.
   */
  initTokenClient(config: {
    /** The OAuth client id (public). */
    client_id: string;
    /** The scope ('…/auth/drive.file'). */
    scope: string;
    /** The account to preselect. */
    hint?: string;
    /** Called with the token or an error. */
    callback: (response: TokenResponse) => void;
    /** Called when the popup was closed or blocked. */
    error_callback?: (error: { type?: string }) => void;
  }): TokenClient;
}

/** Google's loader (gapi). */
interface GapiLoader {
  /**
   * Loads a module.
   * @param name The module ('picker').
   * @param done Called once loaded.
   */
  load(name: string, done: () => void): void;
}

/** The window with Google's globals once loaded. */
type GoogleWindow = Window & {
  /** Google's loader. */
  gapi?: GapiLoader;
  /** Google's namespaces. */
  google?: {
    /** The Picker. */
    picker?: PickerNamespace;
    /** Google Identity Services. */
    accounts?: {
      /** Its OAuth 2.0 part. */
      oauth2?: IdentityNamespace;
    };
  };
};

/** Each script's load, shared by every caller. */
const loads = new Map<string, Promise<void>>();

/**
 * Adds one of Google's scripts to the page once.
 * @param src The script's address.
 * @returns When it has loaded.
 * @throws Error when it cannot load (offline, blocked).
 */
function loadScript(src: string): Promise<void> {
  let loading = loads.get(src);
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google Picker could not be loaded'));
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      // A failed load can be tried again later.
      loads.delete(src);
      throw error;
    });
    loads.set(src, loading);
  }
  return loading;
}

/**
 * Loads the Picker module.
 * @returns The picker namespace.
 * @throws Error when Google's script fails.
 */
async function loadPicker(): Promise<PickerNamespace> {
  const win = window as GoogleWindow;
  if (!win.gapi) await loadScript(GAPI_SRC);
  return new Promise<PickerNamespace>((resolve, reject) =>
    win.gapi!.load('picker', () => {
      if (win.google?.picker) resolve(win.google.picker);
      else reject(new Error('Google Picker did not load'));
    }),
  );
}

/**
 * Loads Google Identity Services.
 * @returns Its OAuth 2.0 namespace.
 * @throws Error when Google's script fails.
 */
async function loadIdentity(): Promise<IdentityNamespace> {
  const win = window as GoogleWindow;
  if (!win.google?.accounts?.oauth2) await loadScript(GSI_SRC);
  const oauth2 = win.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Picker did not load');
  return oauth2;
}

/** A Picker ready to open from a click. */
export interface PreparedPicker {
  /**
   * Opens Google's sign-in popup (inside the click), then the Picker, and waits for a folder.
   * @returns The picked folder's id, or null when cancelled or not allowed.
   */
  pick(): Promise<string | null>;
}

/**
 * Gets the Picker ready before the click (ADR-0074): its settings from Kite (admins only) and Google's two
 * scripts, so the click can open Google's popup at once (a popup opened after waiting is blocked).
 * The token the popup returns is Google's to this browser only: it goes into the Picker and nowhere else,
 * and is forgotten with it; Kite's server never issues or receives one.
 *
 * @param api The Drive API client (picker settings only).
 * @returns The prepared Picker.
 * @throws DriveApiError (not an admin, Picker not set up); Error when Google's scripts fail.
 * Called from: GoogleDriveSetting.tsx (admins, when the company account is connected)
 */
export async function preparePicker(api: Pick<DriveApi, 'pickerConfig'>): Promise<PreparedPicker> {
  const [config, picker, identity] = await Promise.all([
    api.pickerConfig(),
    loadPicker(),
    loadIdentity(),
  ]);
  return {
    pick() {
      return new Promise<string | null>((resolve) => {
        const client = identity.initTokenClient({
          client_id: config.clientId,
          scope: DRIVE_FILE_SCOPE,
          // The company account first: the server's stored token must be able to open the folder.
          ...(config.account ? { hint: config.account } : {}),
          callback: (response) => {
            const token = response.access_token;
            if (!token) {
              resolve(null);
              return;
            }
            const folders = () =>
              new picker.DocsView(picker.ViewId.FOLDERS)
                .setIncludeFolders(true)
                .setSelectFolderEnabled(true)
                .setMimeTypes(DRIVE_FOLDER_MIME);
            new picker.PickerBuilder()
              // My Drive's folders, then the Shared Drives the account can reach.
              .addView(folders())
              .addView(folders().setEnableDrives(true))
              .enableFeature(picker.Feature.SUPPORT_DRIVES)
              .setOAuthToken(token)
              .setDeveloperKey(config.apiKey)
              // The project number: the picked folder is granted to Kite's drive.file access.
              .setAppId(config.appId)
              .setTitle('Choose the company folder for calls')
              .setCallback((data: PickerResult) => {
                if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
                else if (data.action === picker.Action.CANCEL) resolve(null);
              })
              .build()
              .setVisible(true);
          },
          error_callback: () => resolve(null),
        });
        // Inside the click: Google's popup is allowed.
        client.requestAccessToken({ prompt: '' });
      });
    },
  };
}
