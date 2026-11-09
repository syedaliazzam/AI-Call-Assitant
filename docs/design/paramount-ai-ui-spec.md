# Paramount AI: UI/UX spec (v1.2.0; colours and motion v1.3.1)

**Goal:** rebuild Kite's interface as **Paramount AI**. It matches the reference app's **layout, structure, flow, component types, sizes, density and behaviour**. It does not copy its look.
**References:** `docs/design/references/v1.2/` (git-ignored). The file names below are the names in that folder.
**Scope:** UI and UX only. Every feature Kite already has keeps working. New behaviour is listed under each screen and in §6.

---

## 0. What to match, and what not to copy

**Match:**
- Layout, spacing rhythm, component sizes and corner shapes.
- The sidebar structure, the cards, the modals and the stepper.
- The compact bars, the panels, the menus, the key-cap chips on buttons, and the hotkeys.
- Light, dark and system themes.

**Do NOT copy:**
- Their logo, parrot or mascot.
- Their green brand colour. *(Changed in v1.3.1, ADR-0058: the developer chose a green accent, .)*
- Their icon artwork. Use **Lucide** icons, the closest meaning for each.
- Their sentences. Use the copy in this file.
- Their model or vendor logos.

Short functional labels are fine to match: Create session, Answer, Screenshot, Chat, Exit, Resumes, Documents.

**Logo:** the developer supplies the Paramount AI mark (`apps/web/public/images/…`). It must not resemble the reference parrot.

## 1. Design tokens (one source: `src/ui/tokens`)

**Font:** Inter Tight (v1.3.0, ADR-0057; Inter before), weights 400, 500 and 600, self-hosted with next/font. Body 16 / 400 / 24.

**Sizes:** measured from the references at 150% Windows scaling, in CSS px. Calibrate by rendering at DPR 1.5 and comparing with the reference.

| Token | Value |
|---|---|
| Page title (H1) | 24 / 500 (v1.3.0; 16 / 600 before) |
| Page subtitle | 14 / 400, muted |
| Sidebar item | 15 / 500, with a 20 px icon and 12 px gap; row height 40; radius 10 |
| Section label (e.g. "Prepare") | 16 / 500, muted (v1.3.0; 13 before) |
| Card date | 12 / 500, uppercase, muted |
| Card title | 18 / 500 |
| Card role | 14, muted |
| Modal title | 24 / 500 |
| Modal subtitle | 15, muted |
| Field label | 14 / 500 / 20 (v1.3.0) |
| Input text | 15 |
| Helper text | 14, muted |
| Buttons | 14 / 500 / 20 (v1.3.0). Standard 36 tall, padding 8 × 16; large primary (modal footers) 52 tall, padding 0 × 20; icon buttons 36 × 36, round; text buttons radius 10; a subtle shadow on raised buttons (primary, accent, secondary, danger) |
| Tabs | 44 tall, padding 12 × 16, radius 14 at the top; 16 / 500, the selected one 600 (v1.3.0) |
| Search | 39 tall, 14 px text, the words 32 px in after the icon (v1.3.0) |
| Session card | outer radius 48, padding 8 / 8 / 12, 1 px border; inner grey panel radius 32, padding 12, a light shadow (v1.3.0) |
| Chips | 12 / 500, pill, 1 px border, 24 px tall, 14 px icon |

**Colours:** light and dark both use neutral zinc.

| Role | Light | Dark |
|---|---|---|
| Page | `#FFFFFF` | `#0F0F11` |
| Sidebar | `#FAFAFA` | `#141417` |
| Inner panel | `#F6F6F7` (v1.3.1; `#F4F4F5` before) | `#1C1C20` |
| Border | `#E4E4E7` | `#2A2A30` |
| Text | `#18181B` (headings `#09090B`, v1.3.1) | `#F4F4F5` |
| Muted | `#71717A` | `#A1A1AA` |
| Primary button | `#18181B` with white text | `#F4F4F5` with `#18181B` text |
| Secondary button | white, 1 px border | — |
| Ghost button | `#F4F4F5` | — |

**Accent (v1.3.1, ADR-0058; blue `#2563EB` before):** **green `#16A34A`** with `#FAFAFA` text, hover `#15803D`, soft `#F0FDF4`. Green text (links, "You") is `#15803D`. It is used for:
- the active step circle and its connector line;
- radio dots and toggles when on;
- the "Create session" split button and the plus tile in the sidebar (soft green, green plus);
- live level bars, the Ready dot, the Team badge, the gift icon, success toasts and focus rings.

v1.3.1 also adds strong text `#09090B` (headings) and a card's inner panel `#F6F6F7`; the dark compact view uses `#18181B` surfaces, white text, `#A1A1AA` muted and `#22C55E` indicators; the desktop cards have a top glow and a faint dot grid. **Motion** (tokens, off under "reduce motion"): hover 150 ms, press 0.98, menus 150 ms fade + 4 px slide, modals and desktop cards 200 ms fade + 0.98, tab underline slide and stepper fill 200 ms, toasts rise 200 ms and hide after 3 s, the desktop's position jumps 150 ms.

**Status colours:** Ready dot = accent; Ended dot = `#A1A1AA`; recording dot = `#EF4444`; the Exit and close buttons = `#DC2626` with white text.

**Radius:**

| Element | Radius |
|---|---|
| Session card, outer | 20 |
| Session card, inner panel | 16 |
| Modal | 20 |
| Menu | 14 |
| Input | 10 |
| Chip | 999 |
| Call bars | 12 |

**Shadows:** menus and modals use `0 8px 30px rgba(0,0,0,.08)`; cards have none.

**Overlay (call):**
- Bar background `rgba(24,24,27,.82)`, controlled by the opacity setting.
- Pill buttons `rgba(39,39,42,.95)`.
- Key-cap chip `rgba(255,255,255,.12)`, 12 / 500.

---

## 2. Brand and rename: display strings only

**Change** "Kite" to **"Paramount AI"** in every user-visible place:
- page titles and the `<title>` tag;
- the sidebar, menus and toasts;
- the user guide;
- window titles;
- the installer `productName`, shortcut name and installer file name;
- the protocol prompt;
- the acceptable-use notice.

**Keep unchanged:**
- the Electron `appId`;
- the **`userData` path** (pin it with `app.setPath('userData', <current path>)` before `ready`);
- IndexedDB names;
- localStorage, cookie and env names;
- `window.kiteDesktop`;
- package names, the repo, the update feed repo and the hotkey ids.

**Gate:** upgrading 1.1.0 → 1.2.0 keeps the user's sessions, settings, sign-in and protection setting.

---

## 3. Screens

### S1 · Header: `header.png`
- **Left (sidebar width):** logo and the "Paramount AI" wordmark, then the sidebar collapse button (Lucide `PanelLeft`).
- **Right:**
  - the page title (**Call Sessions**) and a subtitle: *"Your upcoming calls and everything you've done before."*
  - On the far right, a **split button**: "Create session" plus a ▾ part, divided by a 1 px line, in accent.
- **▾ menu** (`create session button menu.png`): Interview call (`Briefcase`), Regular call (`Phone`), Mock interview (`Bot`). Each opens Create session with that type preselected.
- The main button opens Create session as Interview.

### S2 · Sidebar: `sidebar.png`, `sidebar user menu.png`
- About 252 px wide, collapsible to icons only (state remembered).
- **Main:**
  - **Create session** (accent-tinted 28 px plus tile);
  - **Call Sessions** (`AudioLines`);
  - **Resumes** (`IdCard`);
  - **Documents** (`FileText`);
  - **Ask AI** (`MessageSquare`, Kite's Ask Kite).
- **Section "Prepare":**
  - **Mock Interview** (`Bot`) works, as today.
  - **Resume Maker** (`FilePen`) and **Headshots** (`ImageUp`) show a muted **"Soon"** chip and are disabled, with a tooltip *"Coming soon"*. Clicking does nothing else.
- **The active item** gets a `#F4F4F5` pill.
- **Card slot** (their plan card) becomes a **Desktop app card:**
  - icon `Monitor`;
  - "Paramount AI for Windows";
  - "Hidden from screen share, global hotkeys";
  - a primary button **Download**, or **Open desktop app** if it's installed;
  - ⋮ with *Hide card*.
- **Bottom:** **Help** (`LifeBuoy`) opens the user guide.
- **Footer:** an avatar with initials, name, email, and ⋮.
- **User menu:**
  - Profile;
  - Theme (Light / Dark / System ›);
  - Settings;
  - Admin (admins only);
  - Tutorials ("Soon" chip);
  - Feedback (opens the existing thumbs/report flow, or "Soon");
  - Open desktop app;
  - Log out.
- **Mobile (390 px):** the sidebar becomes a slide-over drawer.

### S3 · Sessions list: `active sessions.png`, `past sessions.png`
- **Tabs:** All · Interview (`Briefcase`) · Regular (`Phone`) · Mock (`Bot`), with an underline on the active tab. "N Sessions" sits on the right, muted.
- **Toolbar:** a search box (*"Search by company or role"*) joined to a sort button (`ArrowUpDown`: newest, oldest, A–Z). A grid/list toggle on the right (`LayoutGrid` / `List`) is remembered.
- **Collapsible sections:** "Active sessions **1**" and "Past sessions **6**" (chevron; the count is muted).
- **Session card**, grid of 2 columns ≥ 1100 px and 1 column below:
  - **Outer:** white, 1 px border, radius 20, padding 8.
  - **Inner panel:** `#F4F4F5`, radius 16, padding 12/16.
    - the **date** (uppercase);
    - **⋮** at the top right: Edit, Duplicate, Download transcript, Delete (with a confirm);
    - the **company logo tile** (24 px) and the **company name** (Regular calls show the title);
    - the **role**;
    - **chips:** the type (`Briefcase` Interview / `Phone` Regular / `Bot` Mock) and **Transcript** (`MessagesSquare`, shown when the transcript is saved).
  - **Footer** (padding 12/16):
    - **Left, line 1:** a status dot and text: **Ready to start** (accent) / **Live** (red, pulsing) / **Ended** (grey).
    - **Left, line 2, muted:** "Not started yet", or `6m 53s · 12 answers`.
    - **Right:** **Start session** (secondary) for active cards, **View transcript** for ended ones (opens Review).
- **Logo tile:** a letter tile (first letter, colour hashed from the name). No external logo service, so company names never leave the device.
- **List view:** the same data in one row per session.
- **Empty state:** an illustration-free message, *"No sessions yet. Create one to get started."*, and the split button.

### S4 · Create session, step 1 (Details): `create session card.png`, `upload resume menu.png`, `documents menu.png`
- **Modal**, about 760 × 600; on 390 px it becomes full-screen with the stepper on top.
- **Left rail** (`#FAFAFA`, about 220 px):
  - title "Create session";
  - subtitle *"Add the call details and choose what the AI can use."*;
  - a **stepper:** 1 Details / 2 Preferences, with 28 px circles and a 32 px connector line. The active or done circle is filled with the accent; the pending one is outlined and muted. The line turns accent when step 1 is done, animated over 200 ms.
  - **Bottom buttons:** **View tutorial** (`Video`, "Soon" tooltip if there's no video) and **Mock presets** (`Bot`, opens the existing Mock Interview presets).
- **Right side:**
  - **Session type:** a segmented control in a grey track, with the white selected segment raised: Interview / Regular / Mock. Switching keeps the shared fields.
  - Helper: *"Got a job post link? We'll fill in the details for you."*, then a full-width secondary button **✨ Paste a job link** (`Sparkles`). See §6.
  - **Company:** an input (*"Company name"*).
  - **Job description:** a textarea, 5 rows (*"Paste the job description"*).
  - **Context** (section label), then two columns:
    - **CV / Resume:** a select. Menu: *None*, the library items (✓ on the selected one, long names wrap), a divider, then **+ Upload a resume**. Upload opens the existing upload and auto-selects the result.
    - **Documents:** a multi-select. When empty, the trigger says *"No documents yet"*. Menu: the items with checkboxes, **+ Add a document**, and a footer row with **Select all** and **Clear**.
  - **Regular and Mock** show their existing fields in this same style. Key terms stay here as the chip input, in a collapsed **Advanced** section at the bottom of step 1 (v1.3.0). Contact name is no longer asked for or shown (a session that has one keeps it).
- **Footer:** **Cancel** (ghost) and **Next** (primary). Next validates the required fields.
- **✕** at the top right closes, with a confirm if anything was typed.

### S5 · Create session, step 2 (Preferences): `preferences.png`, `select language.png`, `select model.png`
Rows have a 20 px icon on the left, a title (15/500) and a subtitle (14, muted), with the control on the right.

**Section "Session":**

| Row | Icon | Subtitle | Control |
|---|---|---|---|
| **Language** | `Languages` | "Language spoken in the call" | A select with a **search box** at the top, the list, and ✓ on the current one. Use Kite's existing languages; don't invent "medical" variants. |
| **Select model** (v1.3.0; "Model" before) | `Cpu` | "Speed or depth" | **Claude Haiku 5.5**, tagged *Recommended*; **Claude Sonnet 5.5**, tagged *Deeper, slower*. A neutral `Sparkles` icon, no vendor logos. See §6. |
| **Answer preferences** | `MessageSquareText` | "How answers look" | A **Configure** button (`Settings`) that opens S6. |
| **AI instructions** | `Sparkles` | "Extra guidance for this call" | **+ Add** opens S7. Once set, it reads **Edit** and the subtitle shows the first 40 characters. |

**Section "Extra":**

| Row | Icon | Subtitle | Control |
|---|---|---|---|
| **Auto answer** | `Zap` | "Answer questions automatically" | A toggle (existing feature) |
| **Save transcript** | `MessagesSquare` | "Others may need to agree to recording" | A toggle, **on** by default. See §6. |

**Footer:** **Back** (ghost) and **Create interview session** (primary). The label follows the type: "Create regular session" / "Create mock interview".

### S6 · Answer preferences modal: `answer preferences card.png`, `…format view.png`, `…length view.png`, `…tone view.png`
**Two panes.**

**Left pane:**
- the title "Answer preferences";
- the subtitle *"Choose how answers are shaped. You can change this during a call too."*;
- a grey grouped list of 3 rows, each with a 36 px white icon tile, a title, the current value (muted) and a › chevron:
  - **Format** (`List`);
  - **Length** (`Gauge`);
  - **Tone** (`AudioLines`).
- **Footer:** **Set as default** (ghost; saves to Settings) and **Save** (primary; disabled until something changes).

**Drill-in views** replace the left pane:
- a title and subtitle;
- **radio cards** (a 1 px border, and a 1.5 px dark border when selected, with an accent radio dot);
- **Back** and **Select** at the bottom.

The drill-in options:
- **Format:**
  - "Read it out": an answer you can say word for word;
  - "Opening line + bullets": one line to say, then points;
  - "Bullets only": short points in your own words.

  Then two toggles: **STAR structure** (i) for behavioural answers (§6), and **Filler words**, disabled, "Soon".
- **Length:** Short (just the essentials) · Balanced (the answer plus useful context) · Detailed (more depth and examples).
- **Tone:** Plain (everyday words) · Professional (precise, formal wording).

These map to Kite's existing format, length and tone values. Add "Balanced" only if it doesn't exist yet; if it doesn't, map it to the current default.

**Right pane, the live preview:**
- A **Question type** select: Behavioural, Coding, Experience check, How do you…, Situational, System design, Technical knowledge, Tell me about yourself.
- Below it, a **static sample answer**: hand-written text in `src/features/preferences/previewSamples.ts`, 8 types × 3 formats. Length shows more or fewer bullets; tone switches between two wordings.
- It re-renders on every change. **No API calls.**

### S7 · AI instructions modal: `Add Instructions card.png`
- About 560 wide.
- Title "AI instructions", and the subtitle *"Notes the AI should use in this session, like company background or how you like to answer."*
- Label **Context**, then a textarea of about 10 rows (*"Role notes, company details, answer style…"*), with a counter if a limit exists.
- **Footer:** **Clear** (ghost) and **Save** (primary; disabled until changed).
- Maps to the existing session instructions field.

### S8 · Choose platform: `choose platform card.png`
- A centred modal, about 440 wide.
- Title "Choose platform", and the subtitle *"Where do you want to run this call?"*
- **Desktop app** (primary, `Laptop`) and **Open in browser** (secondary, `Globe`).
- A text link **"What's the difference?"** opens a small popover:
  - Desktop: hidden from screen share, global hotkeys, captures any app's audio.
  - Browser: no install, needs a shared tab.
- On phone width, Desktop is disabled with *"Needs a computer"*.

### S9 · Open-in-desktop hand-off: `open desktop alert message.png`, the page under `compact view.jpeg`
> **Changed by ADR-0052 (desktop 1.3.0, with account sync):** no session file. The link carries a one-time sign-in code (`paramountai://session/<id>/<code>`, 60 s, used once), and the app opens on the session's start card, signed in, asking first when another account is signed in.

- **The dialog in the reference is drawn by Chrome itself** (a custom-protocol prompt), so we don't style it.
- **We provide:**
  - **A protocol:** `paramountai://session/<id>`, registered by the desktop app (`setAsDefaultProtocolClient`, single-instance lock). The link carries **only a session id**: it is validated as a UUID, and nothing else is read.
  - **The web page shown after choosing Desktop:**
    - *"Click **Open Paramount AI** in your browser's prompt. No prompt? Use the button below."*;
    - a secondary button **Open in desktop app** (`MonitorDown`);
    - a card *"Don't have the desktop app yet?"* with **Download for Windows** (latest release link) and *"Need it for macOS?"* (a "Soon" tooltip);
    - **← Back to dashboard**.
- **STOP AND ASK before building:** sessions live in IndexedDB, which is separate for Chrome and the desktop app. Check how a session created in Chrome reaches the desktop app today. If it doesn't, propose options (create in the desktop only / a local one-time hand-off / other) and wait.

### S10 · Desktop window header and the first card: `first desktop app card appear.jpeg`

> **Changed by ADR-0055 (accounts with account sync):** the first card is "Your sessions"; the Start card matches the reference (Free / Paid tiles, a "Team" badge), and the header has the dark **Buy credits**, which only shows "Not needed, your team account is unlimited." There are no payments.
- **Window header:**
  - the logo and the wordmark;
  - on the right: **compact** (`Minimize2`), **move** (`Move`, drag handle), **⋮**, and **close** (red square, `X`).
  - **No "Buy credits".**
- **Card "Start your session":** a confirmation, not a payment. A summary block shows:
  - the company, role and type chip;
  - CV ✓/–, documents count, language, model, answer preferences.
  - Then a primary **Continue** and **← Back** (goes to the home panel).

### S11 · Connect call session: `connect call session card.jpeg`

> **Changed by ADR-0055 (desktop, accounts with account sync):** "Connect Call Session" in the desktop frame, with the reference's subtitle and tips (Zoom window filtering → How, test privacy → Watch, mock video → Open). No microphone picker, meter or status text (the microphone is on the call bar). The browser's Connect card is unchanged.
>
> **Changed by ADR-0059 (desktop 1.3.1):** no speech-model dialog. The model ships in the installer and gets ready in the background when the app opens; Connect shows a small progress bar only if it is still loading.
- Title "Connect call session", and the subtitle *"Ready when you are. Connect to start the transcript."*
- **Audio source:**
  - a select on the right, defaulting to **System audio**, plus the mic picker (existing).
  - the microphone's **level meter** runs here, before the call. **Connect starts the call**: there is no sound check or second step (ADR-0053). The other side's level shows in the call.
- **A tips list** (a bordered group with dividers; the icon on the left, the link on the right, underlined):
  - `Headphones` *"Use headphones so your mic doesn't pick up the other side."* → **Why**
  - `ShieldCheck` *"Test Private with your phone before a real call."* → **How** (user guide)
  - `PlayCircle` *"No call to practise on? Play a mock interview on YouTube."* → **Open**
- **Footer:** **Back** (secondary) and **Connect** (primary, `Plug`).
- Under the footer: *"Need it for macOS?"* and **← Back to dashboard**.

### S12 · Window ⋮ menu (before the call): `3 dot menu options.jpeg`
1. the email (with a `User` icon, truncated);
2. **Dashboard** ↗ (opens the web dashboard);
3. **Voice profile** ("Soon");
4. **Get help** ↗;
5. **Private** (i), a toggle, the existing feature;
6. **Meeting detect** (i), disabled, "Soon";
7. **Zoom** + − ⟲;
8. **Theme:** 3 icon buttons (light, dark, system);
9. **Log out** (red text).

Rows are 40 tall with dividers between them, radius 14.

### S13 · Compact call bars: `compact view.jpeg`, `compact view icon.jpeg`

> **Changed by ADR-0055:** bar 1 gets a **Transcript** pill with an on/off switch after Chat; the bars are 900 wide; in desktop 1.3.0 clicks in the gaps pass through to the app behind.
**Bar 1** (dark translucent, radius 12, 44 tall), from left to right:
- the screen-audio icon with a red dot and ▾, and the mic icon with a red dot and ▾ (device pickers);
- **Answer** `[Ctrl ↵]`, **Screenshot** `[Ctrl ⇧ ↵]`, **Chat** `[Ctrl ⇧ ␣]`: pill buttons, each with a **key-cap chip**;
- **move** (`Move`) and **compact** (`Minimize2`);
- the **timer** `⏱ 09:33`;
- **⋮** (S16);
- **Exit** (red; confirm; ends the call).

**Bar 2** (narrower, left-aligned under bar 1):
- a **level button** (live accent bars; it toggles the transcript panel);
- **🌐 English ▾**;
- **Clear** `[Ctrl ⇧ ⌫]`;
- collapse.

Under it, the **live strip**: *"Listening…"* or the latest words.

**A separate pill** to the right of bar 2: **● Auto answer Off/On** (a toggle).

**Icon mode** (the compact button):
- everything shrinks to a **48 px dark rounded square** with animated accent level bars;
- drag moves it; click restores;
- the hotkeys keep working.

### S14 · Chat bar: `chat window.jpeg`

> **Changed by ADR-0055:** as in the reference: input "Enter a message…", [Ctrl Alt ↵], Send, ✕. No answer-target switch or microphone button on the bar; voice stays on Ctrl+Shift+Space twice (a red microphone shows while it listens).
- Opens under bar 1 at full width, with Ctrl+Shift+Space.
- A dark input (*"Type a message…"*), then a **screenshot-and-send** button `[⌗ Ctrl Alt ↵]` (new hotkey), **Send** `[↵]` (muted until there's text), and **✕**.
- The **mic** for dictation stays. Pressing **Ctrl+Shift+Space twice** opens it with the mic on and auto-sends after 1.5 s of silence; Esc cancels.

### S15 · Transcript and answer panels: `transcript ans answer window.jpeg`
**Left: transcript**
- **Header:** the level button, 🌐 language ▾, **Clear** `[Ctrl ⇧ ⌫]`, collapse.
- **Bubbles:**
  - **You** on the right, **Them** on the left;
  - bold-ish 15 px text;
  - a meta line `You · 12:29 AM` (muted, 12 px);
  - "Answer this" on Them's questions (existing).
- A **"Scroll to bottom"** chip when you're scrolled up.

**Right: answers**
- **Header:** `[Ctrl ←]` `[Ctrl →]` nav chips; on the right, **● Auto answer Off**, **Clear** `[Ctrl ⌫]`, collapse.
- **Card:**
  - the **question title** with a 2 px accent bar on its left;
  - the bold answer line;
  - bullets;
  - Tip / coding sections (existing);
  - **footer:** copy, 👍, 👎 on the left; `Answer · 12:32 AM` (or Chat / Screenshot) on the right.
- A **resize grip** at the bottom right.

Both panels are dark translucent and follow the opacity and text-size settings.

### S16 · ⋮ menu during the call: `trancrit window and 3 dot menu.jpeg`
1. the email;
2. Dashboard ↗;
3. Get help ↗;
4. **Private** (i);
5. **Zoom** + − ⟲;
6. **Theme** (3 icons);
7. **Opacity** + − ⟲;
8. **Answer text size** + − ⟲;
9. 🌐 **Language** ▾;
10. **Auto answer** (toggle);
11. **Answer preferences** (i), opening S6 as a compact sheet;
12. **Edit session** (i).

It is dark in the call theme.

### S17 · Not in these references: restyle only, using the tokens
- the browser split view;
- Review (Conversation and Answers tabs);
- Settings;
- the Resumes and Documents libraries;
- Ask AI;
- Mock Interview;
- Admin → Users;
- sign-in and change password;
- the error screens;
- the acceptable-use notice.

---

## 4. Hotkeys (unchanged, plus one new)

| Action | Shortcut | Scope |
|---|---|---|
| Answer | Ctrl+Enter | Global |
| Screenshot | Ctrl+Shift+Enter | Global |
| Chat | Ctrl+Shift+Space (twice = voice) | During a call |
| **Screenshot + send chat message (new)** | **Ctrl+Alt+Enter** | Chat bar open |
| Ask AI | Ctrl+Alt+K | Global |
| Show or hide | Ctrl+Alt+H | Global |
| Move | Ctrl+Alt+Arrows (+Shift) | Global |
| Previous / next answer | Ctrl+← / Ctrl+→ | Focused |
| Clear answer | Ctrl+Backspace | Focused |
| Clear transcript strip | Ctrl+Shift+Backspace | Focused |

Every key-cap chip reads from the hotkey map; none are hard-coded. On macOS, Ctrl shows as ⌘.

## 5. "Soon" items (visible, disabled, tooltip "Coming soon")
Resume Maker, Headshots, Tutorials, Voice profile, Meeting detect, Filler words, the macOS download, and View tutorial (until a video exists).

## 6. New behaviour (small, behind the UI)

| Item | Default decision |
|---|---|
| **Paste a job link** | A server route fetches the URL (**https only; block private, loopback and link-local IPs, including after redirects; 5 s timeout; 2 MB cap; HTML only**), strips the page to text, and **Haiku 5.5** extracts company, role and JD. On failure: *"Couldn't read that page. Paste the description instead."* About $0.001 per use. Don't log URLs or page text. |
| **Model per session** | An allow-list of `haiku-5-5` (default) and `sonnet-5-5`. The server rejects anything else. Sonnet costs about 20× per answer, so admins can turn it off in Admin settings. |
| **Save transcript off** | At End, the transcript lines are deleted from IndexedDB. Notes, answers and lessons are kept. The card shows no Transcript chip, and Review shows "Transcript not saved". |
| **STAR structure** | When on, behavioural answers use Situation, Task, Action, Result bullets. This is a prompt change, so run the **preferences** eval group once (state the cost first). |
| **Desktop app card** | The sidebar card detects the installed app via the protocol, or shows Download. |

## 7. Acceptance checks per screen
- Render each screen in light and dark at 1440 px (and 390 px for web pages) at DPR 1.5.
- Save each beside its reference in a git-ignored `docs/testing/v1.2-visual/` folder, and inspect each pair yourself.
- **Layout and size within about 4 px;** colours, icons and wording follow this spec, not the reference.
- **The existing suites stay green:** unit, harness, desktop smoke, production e2e.
- **The upgrade from a real 1.1.0 install keeps the data** (§2).
