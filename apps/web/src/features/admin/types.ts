/**
 * File: apps/web/src/features/admin/types.ts
 * Purpose: Shapes shared by the admin users screen (client components) and its server actions.
 * Used by: src/features/admin/*.tsx, app/(app)/admin/users/actions.ts, app/(app)/admin/users/page.tsx
 * Depends on: nothing (types only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Admin: users), §8.2
 */

/** A role a Kite account can have. */
export type Role = 'admin' | 'user';

/** One row of the users table (a copy of the server's UserAccount, safe to send to the browser). */
export interface UserRow {
  /** User id. */
  id: string;
  /** Display name. */
  name: string;
  /** Login email. */
  email: string;
  /** 'admin' or 'user'. */
  role: Role;
  /** True when an admin has disabled the account. */
  disabled: boolean;
  /** True until the user replaces their temporary password. */
  mustChangePassword: boolean;
  /** When the account was created. */
  createdAt: Date;
  /**
   * The latest day the person used Paramount AI (a sign-in session's last refresh, or a Claude
   * request), or null when nothing is recorded (for example a new account, or one signed out).
   */
  lastActiveAt: Date | null;
}

/** Result of a row action (reset password, disable/enable, change role). Never thrown. */
export type AdminActionResult =
  | {
      /** The action worked. */
      ok: true;
      /** Only for reset password: the new temporary password, shown once. */
      temporaryPassword?: string;
    }
  | {
      /** The action failed. */
      ok: false;
      /** Message to show the admin. */
      error: string;
    };

/** State of the create-user form (used with React's useActionState). */
export type CreateUserState =
  | {
      /** Nothing submitted yet. */
      status: 'idle';
    }
  | {
      /** The account was created. */
      status: 'created';
      /** Email of the new account, to show next to the password. */
      email: string;
      /** The temporary password to share with the person, shown once. */
      temporaryPassword: string;
    }
  | {
      /** Creating the account failed. */
      status: 'error';
      /** Message for the whole form. */
      error?: string;
      /** Messages for single fields, keyed by the input's name. */
      fieldErrors?: Partial<Record<'name' | 'email' | 'role', string>>;
    };

/** The server actions the admin screen calls, passed in as props by the page. */
export interface AdminUserActions {
  /** Creates an account from the create-user form. */
  createUser: (previous: CreateUserState, formData: FormData) => Promise<CreateUserState>;
  /** Gives a user a new temporary password. */
  resetPassword: (userId: string) => Promise<AdminActionResult>;
  /** Disables (true) or enables (false) an account. */
  setDisabled: (userId: string, disabled: boolean) => Promise<AdminActionResult>;
  /** Changes an account's role. */
  setRole: (userId: string, role: Role) => Promise<AdminActionResult>;
}
