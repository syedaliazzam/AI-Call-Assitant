# ADR-0128: Hotkeys for the computer you are on, a Mac / Windows switch, and one source for every screen

- **Status:** Accepted (27 Nov 2026; branch `session-duplicate-and-mac-keys`, web only)
- **Date:** 2026-11-27
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.3 (hotkeys), §5 (Settings, Help) (version 4.67.0)
- **Supersedes / superseded by:** extends ADR-0029 (Settings → Hotkeys), ADR-0095 (a row shows the keys an older app holds) and ADR-0110 (amended 27 Nov 2026: the Mac keys are the Windows keys with ⌃ for Ctrl, Mac 1.8.1)

## Context

The Mac keys changed with Mac 1.8.1 (ADR-0110 amended, ADR-0127): every Windows key with Control (⌃) for Ctrl and Option (⌥) for Alt. Settings → Hotkeys already picked the Mac set on a Mac, but:

1. **Nobody could see the other set.** A Windows user helping a Mac colleague (or the reverse) saw only their own keys, and the developer reported that Settings "only shows the Windows hotkeys".
2. **An older desktop app's group rows were wrong.** `rowKeys()` (ADR-0095) showed the keys an older app reports holding for a single-key row, and for the arrow rows (`…+Arrows`), but for the other group rows ("Previous or next answer" `Control+Left / Right`, "Zoom" `Control+= / - / 0`) it fell back to the table's new keys. A Mac 1.8.0 app holds ⌃⌥← / → and ⌃⌥= / - / 0, so its Settings showed keys that do not work from other apps.
3. **Help disagreed with Settings.** The guide's Hotkeys section was a hand-written Markdown table, which `/help`'s Markdown splitter cannot draw (it has no tables): it showed as one paragraph of `|` characters. The guide's text also had stale Mac asides ("**⌘ ⌥ X** on a Mac" for Click-through) and named only Windows keys.
4. **Tooltips and notices disagreed on a Mac.** Some labels were written by hand: "Press Answer (⌘Enter)" (call window), "Press ⌘ Enter when they ask something." (overlay), "Nothing new to answer. Press Answer (Ctrl+Enter)…" (both), the drag handle's "⌘ ⇧ Arrows", the Connect card's "Ctrl+Alt+R". Since 1.8.1 a Mac uses ⌃, never ⌘. And the key-caps and tooltips always showed the table's keys, while Settings showed what an older app holds.

## Decision

Web only. No change to the desktop shell, the bridge, the server or stored data; every desktop app (Windows 1.6.x–1.7.5, Mac 1.8.0–1.8.1) gets it on its next page load.

1. **One rule, in `@kite/shared`.** `heldAccelerator(hotkey, mac, statuses)`: the keys the desktop app reports holding (`checkHotkeys()`), else the table's keys for that computer (`hotkeyAccelerator()`). Transcript, Escape and Enter always use the table's keys (the page reads them; the app never holds them). `heldRowKeys(row, statuses, mac)` generalises ADR-0095 to every group row: when the app holds other keys for one of the row's shortcuts, the group shows the held **modifiers** in place of the table's (Mac 1.8.0: `⌃ ⌥ ← / →`, `⌃ ⌥ = / - / 0`, `⌃ ⌘ Arrows`; Windows 1.6.5: `Ctrl+Alt+Arrows`; Windows 1.7.4: `Ctrl+Alt+H`).
2. **One store in the web app, `src/ui/shownKeys.ts`.** It asks the desktop app once per page load which keys it holds (in a browser the answer is null at once), keeps the report, and lets components subscribe (`useHeldHotkeys()`). `shownAccelerator()` / `shownKeyLabel()` read through `heldAccelerator()`. Settings → Hotkeys hands its own, newer check to the store. Every key on screen goes through it: the key-caps (`KeyCap`), the call bars' tooltips and screen-reader words (ControlBar, StatusBar, OverlayAnswer, RecordControls, LiveMenu, TopBar), the empty-answer notices (AnswerPanel, OverlayAnswer, `nothingNewNotice()` in useLiveAnswers), the Click-through hint, and the Connect card's Rec key. The hand-written ⌘ and Ctrl labels listed above are gone.
3. **Settings → Hotkeys opens on this computer's set, with a small "Keys for: Mac / Windows" switch** (`SegmentedControl`). The other set is the table's keys (the app's report and its clash warnings describe only this computer), with a line saying which apps it applies to. The Mac notes (Mission Control, Teams, text keys, VoiceOver) show with the Mac set; "macOS may not report a clash" only on a Mac, in the desktop app.
4. **Help shows Settings → Hotkeys' own list.** The guide's table is replaced by a `{{hotkeys}}` paragraph, which `/help` renders as `<HotkeyList />` (same rows, keys, switch and notes). On a Mac, keys written in bold in the guide read as the Mac's (`guideKeysFor()`: "**Ctrl+Alt+K**" → "⌃ ⌥ K", "**Ctrl+Shift+Left / Right**" → "⌃ ⇧ ← / →"), made with the shared `macKeys()` and `hotkeyLabel()`. A unit test fails if the guide names in bold a key that is not in the shared table.

## Consequences

- Settings, Help, the key-caps and the tooltips read keys by one rule, so on one page they never disagree.
- **Where the held keys show (found in the production run, 27 Nov 2026).** A desktop app with account sync (every account, ADR-0092) shows only the call in its own windows. Settings and Help open in the system browser (ADR-0055, `features/shell/desktopPages.ts`), which has no desktop bridge. So the keys an older app holds (Mac 1.8.0, Windows 1.7.4) appear in its own windows: the call bars' key-caps and tooltips, the notices, the Click-through hint and the Connect card. Settings and Help in the browser show the current table's keys for that computer, which is what the browser did before this change too. Both older apps update themselves to 1.8.1 / 1.7.5, whose keys are the table's. If the browser should ever name an older app's keys, the desktop app would have to publish what it holds (for example as a synced preference). That would be a separate decision.
- `heldRowKeys()` still applies the held keys in Settings whenever Settings renders where the bridge exists, and it is unit-tested against the released apps' tables.
- Outside a call, the first screen that shows a key in the desktop app asks the app which keys it holds. The app answers as Settings → Hotkeys always made it answer: it tries each call key and releases it straight away. Inside a call it answers from what it holds. Once per page load.
- Until the app answers (a fraction of a second), and during the server render, screens show the table's keys for the computer. Before hydration that is the Windows set, as before.
- `/help` is now a client component (it needs the computer). Its text is still rendered as text only.
- The guide's raw Markdown shows `{{hotkeys}}` where the table was; the sentence before it says the list is Settings → Hotkeys'.

## Alternatives considered

- **Show both sets side by side in Settings** (two Keys columns). Rejected: twice as wide in a narrow settings card, and the developer asked for a switch.
- **Keep a hand-written table in Help, both columns.** Rejected: it drifts (it already had), and `/help` cannot draw a table without a Markdown change.
- **Tokens such as `{{key:answer}}` throughout the guide's text.** Rejected: the guide must stay readable as a document; the Mac words follow from the Windows ones by the shared rule, and the unit test ties every bold key to the table.
- **Pass the held keys down as props.** Rejected: dozens of props through the overlay; a small store read at render, with a subscription in each bar, keeps the change local.

## Validation

- Unit: `tests/unit/shared/heldKeys.test.ts` (reports rebuilt from the released Mac 1.8.0, Windows 1.6.5 / 1.7.4 tables and today's; single keys, every group row, Transcript stays the table's), `tests/unit/ui/shownKeys.test.ts` (table before a report, held after, a newer report wins), `tests/unit/features/settings/HotkeyList.test.ts` (the switch's report only for this computer's set; the same rows in both sets; Mac 1.8.0's ⌃ ⌥ group rows), `tests/unit/features/help/guideKeys.test.ts` (Mac words, groups, non-keys untouched; every bold key in the table; the marker, no table, no ⌘ ⌥ X).
- Production end-to-end (`tests/e2e-prod/duplicate-and-keys.spec.ts`, passed 27 Nov 2026 on `dpl_Asy8JV5oWehdRsyykUfdEGugwCug`): Chrome on Windows opens Settings → Hotkeys on the Windows set, the switch shows ⌃ symbols, and Help shows the same list. In the desktop app (this checkout's shell, Windows), the Connect card's Rec key comes from the store and the shell reports the keys it holds (25 statuses).
- On a real Mac (developer): Settings opens on the Mac set; the bars' tooltips say ⌃.
