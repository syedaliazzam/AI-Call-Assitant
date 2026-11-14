/**
 * File: apps/web/src/features/admin/addUserSignal.ts
 * Purpose: Lets the header's "Add user" button (outside the page) open the Users page's Add user
 *          dialog: the button sends a window event, and the page, which owns the dialog, listens.
 * Used by: src/features/admin/AddUserButton.tsx (sends), src/features/admin/UsersPage.tsx (listens)
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1, S17)
 */

/** The event's name. */
export const ADD_USER_EVENT = 'kite:add-user';

/**
 * Asks the Users page to open its Add user dialog.
 *
 * @returns Nothing.
 * Called from: AddUserButton.tsx
 */
export function requestAddUser(): void {
  window.dispatchEvent(new Event(ADD_USER_EVENT));
}

/**
 * Calls `onRequest` each time the header asks for the dialog.
 *
 * @param onRequest Opens the dialog.
 * @returns A function that stops listening (for a React effect's clean-up).
 * Called from: UsersPage.tsx
 */
export function onAddUserRequest(onRequest: () => void): () => void {
  window.addEventListener(ADD_USER_EVENT, onRequest);
  return () => window.removeEventListener(ADD_USER_EVENT, onRequest);
}
