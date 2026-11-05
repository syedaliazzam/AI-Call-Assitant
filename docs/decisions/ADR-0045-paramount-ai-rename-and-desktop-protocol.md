# ADR-0045: The Paramount AI rename, the desktop link, and the v1.2.0 interface

- **Status:** Accepted
- **Date:** 2026-11-05
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §3.3, §5, §7.2, §7.3; `docs/design/paramount-ai-ui-spec.md`
- **Supersedes / superseded by:** adjusts ADR-0033 (the opacity default) and ADR-0041 (the stacked overlay's layout)

## Context

v1.2.0 rebuilds the interface to a new spec and gives the product a new name, "Paramount AI". Three things could go wrong if this were done naively:

1. **Renaming can lose data.** Electron derives the data folder from the product name. Renaming the product would move `%APPDATA%\Kite` and the app would open with no sessions, no settings and no sign-in.
2. **A browser session cannot reach the desktop app.** Sessions live in IndexedDB, separately per browser and per desktop app (ADR-0024), and call data stays off the server. "Open in desktop app" needs a way across.
3. **People do not update at once.** A 1.1.0 desktop app loads the new web app the moment it is deployed.

## Decision

### The rename is display strings only

"Kite" becomes "Paramount AI" in page titles, menus, the user guide, window titles, the installer's product name, shortcut and file name, the protocol prompt and the acceptable-use notice. These stay as they are: the Electron `appId` (`co.paramountintelligence.kite`), the data folder, IndexedDB names, `kite.*` storage keys, cookie and environment names, `window.kiteDesktop`, package names, the repository, the update feed, hotkey ids, the export format id, and the install folder (`extraMetadata.name: kite`).

- The data folder is pinned: `app.setPath('userData', %APPDATA%\Kite)` before anything reads it, only in an installed app and only when `--user-data-dir` was not passed, so test runs keep their temporary profiles.
- The AI's own name changes in one place only, the Ask AI rule. The live-call prompts are unchanged, so measured answer quality stays comparable.

### The desktop link and the session file (the developer's option B)

- **`paramountai://session/<id>`** opens the desktop app on that session's start card. The link carries a session id and nothing else; it is checked as a UUID and no other part is read. It only brings a window forward: a link can come from any web page, so it never starts a call or changes anything. During a call it brings up the overlay.
- The protocol is registered by the installer and by the installed app. It is never registered by a run with `--user-data-dir`, so a test cannot change what the computer opens.
- **The session reaches the desktop as a file.** Choosing Desktop app in the browser saves `paramount-ai-session-<short id>.json` to the downloads, in the export format, holding that session and its documents and nothing from any call. The desktop app asks for it in the system's own file dialog.
- **A newer copy replaces an older one** and keeps what the desktop did with it (its status, its last call). An older or identical file changes nothing.
- **The page never names a path.** The shell remembers the file the person picked in its dialog, and "Delete the hand-off file" deletes that one file, once. A web page therefore cannot use this to read or delete anything else.
- Creating the session in the desktop app stays fully supported, and is what the guide recommends for desktop calls.

### The call interface

- **Bars and panels** follow spec S13–S16. Both panels sit side by side when the window is 900 px or wider and stack when it is not (a container query, so any window works). From 1.2.0 the shell widens the window about its centre for both panels, undoes exactly that afterwards, and remembers the narrow place.
- **Icon mode.** A shell from 1.2.0 can shrink the overlay to a 48 px square. Dragging is done by the page through a checked `moveOverlay` call, because a window drag region would swallow the click that restores it.
- **Ctrl+Alt+Enter** sends the chat bar's message with a screenshot. A global shortcut takes its keys from every other app, so from 1.2.0 it is held only while the chat bar is open, and only during a call. Settings reports a clash.
- **Ctrl+Shift+Space twice** opens the chat bar with the microphone on. Presses under 60 ms apart are a held key repeating, not a double press. Dictation now sends after 1.5 s of silence (1.2 s before), as the spec asks.
- **Bar opacity defaults to 82 %** (70 % in ADR-0033), as the spec asks. A value someone already chose is kept.

### An older desktop shell keeps working

| In a 1.1.0 shell | What happens |
|---|---|
| Compact | Collapses to bar 1, as today: that shell cannot make a window that small |
| Bars with no panel open | Its fixed height is too short for the new bar 2, so the page asks for what it needs through `OverlayLayout.popupHeight`, which 1.1.0 already honours |
| Both panels | Stack in its window, or sit side by side if the person widens it |
| Ctrl+Alt+Enter | Works while the overlay has focus; that shell cannot hold it globally |
| paramountai:// and the session file | Not available until the desktop app updates |

Every new shell call is optional on the bridge, so the page never depends on it.

### Removed and added

- `/api/preview` and its server code are gone: the preview is written from hand-made samples and costs no request.
- `/api/models` and the `deep_model_enabled` setting let an admin turn Sonnet off; a session set to it then uses Haiku. Stored model values stay `fast` and `smart`.
- `style.star` adds one line to the session block only when it is on, so answers are unchanged for everyone who does not use it.

## Consequences

- Upgrading keeps everything, but the code now has two names: identifiers say Kite, people read Paramount AI. This is deliberate and is stated in the spec.
- The hand-off is a manual step, and it leaves a file in the downloads until the person deletes it. It holds the person's own documents, so the delete is offered and ticked by default.
- Bars are narrower than a window that has been widened for both panels, and the empty parts of a see-through window still catch clicks.
- A place saved by 1.1.0 is widened once, to fit bar 1's key-caps. A width chosen after that stays.

## Alternatives considered

- **Moving the data folder to the new name.** Rejected: a migration with a failure mode that loses people's data, for no gain they can see.
- **Sending the session through the server.** Rejected: call data stays off the server (architecture §8.1).
- **Creating sessions only in the desktop app.** Rejected by the developer: browser sessions must be able to reach the desktop.
- **A path in the delete call.** Rejected: any page that could call it could ask to delete any file.

## Validation

- Unit tests: `apps/desktop/tests/unit/handoff.test.ts`, `windows.test.ts`, `hotkeys.test.ts`; `apps/web/tests/unit/core/session/handoff.test.ts`, `core/live/doublePress.test.ts`, `platform/keymap.test.ts`.
- Harnesses: `test:handoff`, `test:live-ui`, `test:sim-calls`, `test:screens`.
- Electron smoke: the icon is really 48 px on the system, it moves and restores, and Private hides every window, measured by capture.
- `apps/desktop/tests/manual/upgrade.spec.ts`: the real 1.1.0 program, then 1.2.0, on one temporary profile. `old-shell.spec.ts`: a real 1.1.0 program against the new web app.
- Eval: the `preferences` group, with the new STAR scenario.
