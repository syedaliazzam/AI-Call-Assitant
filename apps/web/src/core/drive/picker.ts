/**
 * File: apps/web/src/core/drive/picker.ts
 * Purpose: Opens Google Picker for choosing the Drive folder calls are saved in (ADR-0072): folders only,
 *          My Drive and Shared Drives, with setSelectFolderEnabled and setAppId (the project number), so
 *          the picked folder is shared with Kite's drive.file access. Loads Google's script on first use.
 *          Runs in a browser only: the desktop app opens Settings in the system browser for this.
 * Used by: src/features/drive/GoogleDriveSetting.tsx
 * Depends on: Google's https://apis.google.com/js/api.js (loaded here), src/core/drive/api.ts
 * Architecture: ADR-0072
 */
import { DRIVE_FOLDER_MIME } from '@kite/shared';
import type { DriveApi } from './api';

/** Google's loader script. */
const GAPI_SRC = 'https://apis.google.com/js/api.js';

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
  };
};

/** The script load, shared by every open. */
let loading: Promise<PickerNamespace> | null = null;

/**
 * Loads Google's script and the picker module once.
 *
 * @returns The picker namespace.
 * @throws Error when the script cannot load (offline, blocked).
 */
function loadPicker(): Promise<PickerNamespace> {
  loading ??= new Promise<PickerNamespace>((resolve, reject) => {
    const win = window as GoogleWindow;
    const ready = () =>
      win.gapi!.load('picker', () => {
        if (win.google?.picker) resolve(win.google.picker);
        else reject(new Error('Google Picker did not load'));
      });
    if (win.gapi) {
      ready();
      return;
    }
    const script = document.createElement('script');
    script.src = GAPI_SRC;
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error('Google Picker could not be loaded'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // A failed load can be tried again later.
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Opens the Picker and waits for a folder.
 *
 * @param api The Drive API client (picker settings and an access token).
 * @returns The picked folder's id, or null when cancelled.
 * @throws DriveApiError (not connected, reconnect, Picker not set up); Error when Google's script fails.
 * Called from: GoogleDriveSetting.tsx (after connecting, and Change folder)
 */
export async function pickDriveFolder(
  api: Pick<DriveApi, 'pickerConfig' | 'token'>,
): Promise<string | null> {
  const [config, token, picker] = await Promise.all([
    api.pickerConfig(),
    api.token(),
    loadPicker(),
  ]);
  const folders = () =>
    new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(DRIVE_FOLDER_MIME);
  return new Promise<string | null>((resolve) => {
    new picker.PickerBuilder()
      // My Drive's folders, then the Shared Drives the person can reach.
      .addView(folders())
      .addView(folders().setEnableDrives(true))
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token.accessToken)
      .setDeveloperKey(config.apiKey)
      // The project number: the picked folder is granted to Kite's drive.file access.
      .setAppId(config.appId)
      .setTitle('Choose the folder for your calls')
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
