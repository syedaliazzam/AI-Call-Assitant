/**
 * File: apps/web/src/server/google/config.ts
 * Purpose: Reads the Google Drive and email settings from the environment (ADR-0072). Each part is
 *          optional: without the Google client the feature says "not set up" instead of failing, and
 *          without RESEND_API_KEY and NOTIFY_FROM_EMAIL the "saved" email stays off ("Email not set
 *          up") while uploads still work. Values are never logged or sent to a browser, except the
 *          Picker key and project number, which Google Picker needs in the page.
 * Used by: src/server/google/api.ts, src/server/google/notify.ts
 * Depends on: nothing
 * Architecture: ADR-0072; docs/deploy/google-drive.md (the variables, and switching projects)
 *
 * Swapping the test Google project for the team's changes only these values (no code, no ids).
 */
import 'server-only';

/** Environment variables (process.env, or a test's own). */
export type GoogleEnvSource = Readonly<Record<string, string | undefined>>;

/** The Google OAuth client and Picker settings. */
export interface GoogleConfig {
  /** The OAuth client id (a Web application client). */
  clientId: string;
  /** The OAuth client secret. Server only. */
  clientSecret: string;
  /** The Picker API key, or null when not set (Change folder is then unavailable). */
  pickerApiKey: string | null;
  /** The Google Cloud project number (Picker's setAppId), or null when not set. */
  appId: string | null;
}

/** The email sender settings (Resend). */
export interface EmailConfig {
  /** The Resend API key. Server only. */
  apiKey: string;
  /** The sender, for example "Paramount AI <notify@paramountintelligence.co>". */
  from: string;
}

/**
 * A variable's value, or null when missing or blank (`vercel env pull` writes NAME= lines).
 *
 * @param env  The variables.
 * @param name The name.
 * @returns The trimmed value, or null.
 */
function value(env: GoogleEnvSource, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

/**
 * The Google settings.
 *
 * @param env The variables (default process.env).
 * @returns The settings, or null when GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set.
 * Called from: api.ts (every Google route), tests
 */
export function googleConfig(env: GoogleEnvSource = process.env): GoogleConfig | null {
  const clientId = value(env, 'GOOGLE_CLIENT_ID');
  const clientSecret = value(env, 'GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    pickerApiKey: value(env, 'GOOGLE_PICKER_API_KEY'),
    appId: value(env, 'NEXT_PUBLIC_GOOGLE_APP_ID'),
  };
}

/**
 * The email settings.
 *
 * @param env The variables (default process.env).
 * @returns The settings, or null unless RESEND_API_KEY and NOTIFY_FROM_EMAIL are both set.
 * Called from: api.ts (status, notify, retry), tests
 */
export function emailConfig(env: GoogleEnvSource = process.env): EmailConfig | null {
  const apiKey = value(env, 'RESEND_API_KEY');
  const from = value(env, 'NOTIFY_FROM_EMAIL');
  return apiKey && from ? { apiKey, from } : null;
}
