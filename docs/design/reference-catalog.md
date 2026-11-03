# ParakeetAI reference catalog (v1.1.0)

**Purpose:** one row per reference image, so anyone can see what Kite is being compared with without opening another company's screens.

**The images are not in this repository.** Originals are in `D:\Paramount Intelligence\Parakeet AI\images`. Descriptively named copies are in `docs/design/references/`, which is git-ignored. Never commit them.

**What we match:** structure, layout, behaviour, hotkeys and transparency. **What we do not match:** colours, logo, emoji set and wording. Kite keeps its own tokens, icons, logo and words (`docs/design/kite-ui-theme.md`).

**Viewed:** 21 of 21 images, 4 Nov 2026. "Newest" means the frame has the current hotkeys and the timer pill. Personal details visible in some frames are deliberately left out of this file.

## Desktop app: between calls

| Copy | Original | What it shows | Key elements | Behaviours |
|---|---|---|---|---|
| `desktop-home.png` | `desktop-home.png` | The app's default window: a compact panel listing sessions | Header: logo, credits chip, collapse, move, ⋮, red close. Search by title or description, sort button. Cards: date, ⋮, title, description, type chip, Transcript chip, status dot and word, duration and credit, View Transcript. Fixed bottom row: View in Dashboard ↗ and a solid Create Session | Tall narrow window. The list scrolls; the header and bottom row stay. Cards respond to the pointer |
| `desktop-menu-idle.png` | `desktop-menu.png` | The ⋮ menu over the home panel | Account row (person icon, name, email). Dashboard ↗. Private toggle with info icon. Meeting Detect toggle with info icon, greyed out. Zoom + / − / reset. Theme light / dark / system (light selected). Logout | Floats over the panel. Rows are grouped in rounded blocks. The row under the pointer highlights |
| `desktop-dock-icon.png` | `desktop-menu-idle.png` | Only the app's Dock icon with its name as a tooltip | Icon, tooltip | None. **The original's file name is misleading: it is not a menu. The idle menu is `desktop-menu.png`.** |

## Desktop app: during a call

| Copy | Original | What it shows | Key elements | Behaviours |
|---|---|---|---|---|
| `desktop-bars.png` | `main window.png` (older build) | All three stacked pieces over a light page | Bar 1: screen-audio and mic icons with red dots, Answer ⌘↵, Screenshot ⌘⇧↵, Chat ⌘⇧⌫, move, collapse, ⋮, red End. Bar 2: level bars, words as chips, Clear ⌘⇧⌫, expand. Answer panel: ⌘← ⌘→, Clear ⌘⌫, expand; Question with copy; divider; Answer line; bullets; a closing tip; footer "Answer · time", thumbs | Three separate rounded pieces with small gaps, see-through with a blur. **Older than the frames below:** End is a button and Chat is on ⌘⇧⌫ |
| `desktop-answer-panel.png` | `8f0f9978-….png` (newest) | Bars with the answer panel open over a landscape | Timer pill in place of End. Chat ⌘⇧Space. Bar 2: plain words aligned right, not chips, with Clear ⌘⇧⌫ and expand. Panel: ⌘← ⌘→ on the left, Clear ⌘⌫ and collapse on the right; Question, copy; Answer, three bullets; footer | Panel is a little wider than the bars and much taller than its text. The background shows through |
| `desktop-transcript-panel.png` | `95f2bf74-….png` (newest) | Bar 1 with the transcript panel open | Panel header: level bars, language dropdown, Clear ⌘⇧⌫, collapse. Lines: You on the right, the other person on the left, plain text without a filled bubble, "You · 15:09" and "Client 1 · 15:09" under each | **The panel takes bar 2's place**: its header carries bar 2's controls. It is narrower than bar 1 and centred. Oldest at the top. Words not yet final are dimmer |
| `desktop-code-answer.png` | `face2619-….png` (newest) | A coding answer over a coding-problem page | Question: the problem's name. Answer: the approach and three bullets. Key Steps: three bullets. Code: language label, code block, its own copy button | The panel is wider than the bars and runs past the window's right edge. Its background is darker here, and the page behind is still faintly visible |
| `desktop-menu-live.png` | `53e79cfe-….png` (newest) | The ⋮ menu during a call | Account row. Dashboard ↗. Private with info. Zoom. Theme (dark selected). Show logo toggle. Logo size. Opacity + / − / reset. Font size + / − / reset. Language dropdown. Auto Answer toggle. Edit with info | Taller than the bars, so it extends down over the answer panel. Plus and minus disable at their limits |
| `desktop-positions.png` | `desktop-position.png` | Snap zones while the overlay is being dragged | Three ghost layouts along the top of the screen: left, centre, right. Each is a slim bar over a large panel, white and translucent. A thin outline marks the centre zone | Shown only during a drag. Dropping snaps to the zone. Top row only: no bottom zones |

## Browser

| Copy | Original | What it shows | Key elements | Behaviours |
|---|---|---|---|---|
| `browser-split.png` | `yp2XySwT….png`, in the saved page's `_files` folder (older build) | The call page split in two | Left: shared-tab preview with Fullscreen and Change Tab; Transcript heading with Connect (mic), Clear and an AutoScroll switch. Right: logo, time left, Exit; empty state; manual message box with Send; AI Answer (Space) and Analyze Screen | Draggable divider. The right side collapses with a side arrow. **Older than `browser-connect.png`, whose blurred background shows the current layout** |
| `browser-connect.png` | `connect Session.png` | The Connect dialog over the call page | Call summary sentence, edit pencil. How to connect: meeting-app logos, video tutorial. No call to share: mock video. Back and Connect. Blurred behind: screen and Change tab controls, Clear, ⋮, close, message box, Answer and Screenshot | Dark dialog. This is the only frame of the current browser layout, and it is blurred |

## Review and setup (already matched in v1.0.x; compared, not rebuilt)

| Copy | Original | What it shows | Key elements | Behaviours |
|---|---|---|---|---|
| `review-transcript.png` | `Transcript window.png` | The session window, on Transcript | Side menu: AI notes, Transcript, Ask AI, Call details, then promotions. Clear transcript, Download, ⋮, close. Answer inline as a large tinted block; "Answer · time"; Report this answer. You on the right with "You · time" | Modal over the dashboard. Long answers fade at the scroll edge |
| `wizard-details.png` | `Session Window.png` | Create session, step 1 | Type switch: Interview, Regular, Mock. Paste a job link. Company, job description, resume and document pickers with an open "Upload a resume" list. View tutorial, Mock presets. Cancel, Next | Two-step side rail |
| `wizard-preferences.png` | `Create Session .png` | Create session, step 2 | Language, model, Answer Preferences (Configure), AI instructions (Add). Extra: Auto Generate, Save transcript with a consent note. Back, Create | Rows with icons and a control on the right |
| `answer-preferences.png` | `Answer Preferences window.png` | Answer preferences | Left: Format, Length, Tone, Set default, Save. Right: question type picker, answer preview | Two panes; the preview follows the choices |
| `ai-instructions.png` | `AI Instructions window.png` | AI instructions | Title, one line of help, Context box, Clear, Save changes | Save is disabled until something changes |
| `upload-resume.png` | `Upoad CV window.png` | Upload a resume | Dashed drop zone, click to browse, PDF only, Back | Modal |
| `choose-platform.png` | `Choose Platform.png` | Choose platform | Desktop app (solid), Open in browser, What's the difference? | Modal |
| `dashboard.png` | `Parakeet Dashboard.png` | The dashboard | Sidebar: Call Assistant and Prepare groups, plan block, profile. Header, Create session with a dropdown. Type tabs with a count. Desktop-app banner. Search, sort, grid or list. Session card | Kite has this (Resume Maker, Headshots and paid-plan blocks are out of scope) |

## Not UI references

| Copy | Original | What it shows |
|---|---|---|
| `directory-description.png` | `3ObYoSJe7….png`, in the saved page's `_files` folder | A third-party AI-tool directory page describing the product in words. No app screen |
| `directory-listing.png` | `ZV8nFti1….png`, in the saved page's `_files` folder | The same directory's listing, with a marketing page. No app screen |

## Hotkeys seen in the newest frames

| Action | Frame shows | Kite on Windows |
|---|---|---|
| Answer | ⌘↵ | Ctrl+Enter |
| Screenshot | ⌘⇧↵ | Ctrl+Shift+Enter |
| Chat | ⌘⇧Space (⌘⇧⌫ in the older frame) | Ctrl+Shift+Space |
| Clear transcript | ⌘⇧⌫ | Ctrl+Shift+Backspace |
| Clear answer | ⌘⌫ | Ctrl+Backspace |
| Previous, next | ⌘←, ⌘→ | Ctrl+Left, Ctrl+Right |

## States with no reference frame

Kite designs these itself, from the neighbouring frames: the Chat input open in bar 1; "Thinking…" and Stop while streaming; "Jump to latest"; the device picker open; the timer pill's End confirmation; a light-theme overlay (only the ghost zones are light); a code-error, slide or table answer; a clear frame of the current browser layout.
