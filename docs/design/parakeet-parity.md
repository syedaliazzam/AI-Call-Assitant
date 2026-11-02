# ParakeetAI parity plan

**Goal (developer, 2 Nov 2026):** the team uses ParakeetAI today, and switching to Kite should feel natural: same features, same workflow, same layout structure, same hotkeys.

**What is matched and what is not:** Kite matches **function and structure**. It does not copy ParakeetAI's visual design, logo, illustrations, wording or brand. Kite keeps its own brand tokens (`docs/design/kite-ui-theme.md`) and its own copy, and uses simple generic icons in place of meeting-app logos.

**Source:** the developer's screenshots of the dashboard, create session, answer preferences, AI instructions, connect session, overlay, transcript window and resume upload. The architecture change this implies is recorded in ADR-0029.

## Features

Phase 1 is the live call, 2 is session setup, 3 is after the call, 4 is the Prepare tools. "Skip" means out of scope for an internal tool.

### During the call

| ParakeetAI | Kite today | Change needed | Phase |
|---|---|---|---|
| Overlay of three stacked bars: controls, transcript, answer | One compact window: header, latest line, answer, buttons | Rebuild as three bars | 1 |
| Controls bar: mic and audio status, Answer, Screenshot, Chat, move, collapse, menu, End | Answer, Screenshot, Clear; no status, menu or End | Add the rest | 1 |
| Transcript bar: latest words as chips, Clear, expand | Latest line as text | Chips, Clear, expand | 1 |
| Answer card: Question line, answer line, bullets, closing tip | Headline, then bullets behind "Details" | Question line, tip line, no hidden details | 1 |
| Answer footer: mode, time, thumbs, copy | Only in the main window's answer panel | Add to the overlay, plus report | 1 |
| Answer history back and forward | Only in the main window | Add to the overlay | 1 |
| Translucent overlay | Solid window | Opacity slider, fade when not hovered | 1 |
| Resizable overlay | Yes | Keep; one scroll area; 16–18 px text | 1 |
| Global hotkeys, shown on the buttons | Hotkeys exist, not shown in the overlay | New map below; labels on buttons | 1 |
| Connect goes straight to the overlay | Connect stays in the main window | Setting "Start calls in the overlay", default on; minimises the main window | 1 |
| Speakable first-person answers | Headline and bullets, not always first person | First-person script; answer line, bullets, optional tip | 1 |
| Change answer preferences mid-call | No | From the overlay menu | 2 |

### Session setup

| ParakeetAI | Kite today | Change needed | Phase |
|---|---|---|---|
| Types: Interview, Regular, Mock | Interview, Sales, Support, Internal | New types; existing sessions keep working (Sales, Support and Internal become Regular) | 2 |
| Two-step wizard: Details, Preferences | Two steps | Rework step contents | 2 |
| Paste a job link: imports the details | No | Server route fetches the public page; Haiku extracts; user can edit | 2 |
| Resumes and Documents pages, reusable | Documents belong to one session | Two libraries; a session keeps its own copy | 2 |
| Resume and document pickers in the wizard, with upload | Upload per session | Pickers with "Upload a resume" | 2 |
| Answer preferences window with a live preview per question type | Three selects, no preview | Modal, preview generated once by Haiku and cached, "Set as default" | 2 |
| Format: script + bullets, bullets, script | Headline + bullets, paragraph | Three formats | 2 |
| Length and tone options | Short, medium, detailed; simple, professional, friendly | Short, balanced, detailed; simple, professional, technical | 2 |
| Language | English only | Answers in the chosen language; the UI says transcription is English-only for now | 2 |
| Model choice | Fast or smart | Keep | — |
| AI instructions window | A field in the wizard | Own modal, as a separate step | 2 |
| Auto generate (beta), save transcript | Yes (auto-answer in Settings) | Keep; also offer per session | 2 |
| Choose platform: desktop or browser | Yes | Keep | — |
| Connect screen: call summary, how to connect, tutorial, mock video | Instructions and audio check | Add summary sentence, generic app icons with how-tos, tutorial placeholder, mock video link | 2 |
| Dashboard: type tabs with count, search, sort, grid or list | Search and type filter | Tabs, sort, grid or list toggle | 2 |
| Session card: date, company, role, chips, status, Start, menu | Partly | Complete it; menu with rename, duplicate, delete | 2 |
| Create session button with a type dropdown | Button | Add dropdown | 2 |

### After the call

| ParakeetAI | Kite today | Change needed | Phase |
|---|---|---|---|
| Session window: AI notes, Transcript, Ask AI, Call details | One review page | Sections with a side menu | 3 |
| Transcript as chat bubbles with answers inline | Plain lines, answers separately | Bubbles (Them left, You right), answers inline | 3 |
| Report this answer | Rating and note only | Stored locally with the rating note | 3 |
| Clear transcript, Download | Neither | Clear with confirmation; TXT and PDF | 3 |
| Ask AI about the call | No | Chat with Sonnet over the call's data | 3 |

### Prepare tools

| ParakeetAI | Kite today | Change needed | Phase |
|---|---|---|---|
| Mock Interview | No | Kite asks questions aloud (browser speech synthesis, no paid voice), listens, gives feedback and a summary | 4 |
| Question Bank | No | Likely questions for a role, with suggested answers in the user's format | 4 |
| Resume Maker, Headshots | No | Skip | — |
| Credits, upgrade, referrals, "Rate us" | No | Skip | — |

## Hotkeys

On macOS, Ctrl means ⌘. The current app registers Clear, previous and next as global shortcuts; they become focused-only, because system-wide they would break typing in other apps.

| Action | Shortcut | Where it works |
|---|---|---|
| Answer | Ctrl+Enter | Global |
| Screenshot | Ctrl+Shift+Enter | Global |
| Show or hide overlay | Ctrl+Alt+H | Global |
| Move overlay | Ctrl+Alt+Arrows (add Shift for bigger steps) | Global |
| Chat | Ctrl+Shift+Backspace | Kite focused only |
| Clear answer | Ctrl+Backspace | Kite focused only |
| Previous or next answer | Ctrl+Left or Ctrl+Right | Kite focused only |

Global shortcuts need the desktop app; in a browser all shortcuts work only while Kite has focus. Settings → Hotkeys lists them all and reports conflicts. Some Windows graphics drivers use Ctrl+Alt+Arrows to rotate the screen, so that is a likely conflict to report.

## Where Kite will differ, and why

- **Look and words:** Kite's own brand and copy, by design.
- **Browser overlay opacity:** a browser picture-in-picture window cannot be translucent, so the opacity controls exist only in the desktop app.
- **Live transcription:** English only for now. Answers can use other languages.
- **Local data:** sessions, documents and libraries stay on the device, so they do not follow a user between computers (Export and Import cover that).
