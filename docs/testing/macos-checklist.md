# macOS checklist (about 15 minutes)

**What this is:** the first test of the Kite desktop app on a Mac. It is written for a team member with a Mac (macOS 14 Sonoma or later). Nobody has run Kite on a Mac yet, so every step matters. Write down the macOS version and the Mac model (Apple silicon or Intel), and mark each step ✅ or ❌ with a note.

**You need:**
- the unsigned `Kite-<version>-arm64.dmg` (Apple silicon) or `Kite-<version>-x64.dmg` (Intel) from the developer;
- a Kite account;
- headphones;
- a YouTube video or a second person on a Google Meet call.

**Invented data only:** use made-up company names and documents. No real customer calls.

## 1. Install (3 min)

| # | Do | Expect |
|---|---|---|
| 1.1 | Open the `.dmg` and drag **Kite** to **Applications**. | Kite is in Applications. |
| 1.2 | Open Kite from Applications. | macOS says it "cannot be opened because Apple cannot check it for malicious software" (the app is not signed or notarised yet). |
| 1.3 | Open **System Settings → Privacy & Security**, scroll to "Kite was blocked", click **Open Anyway**, then **Open**. (On older macOS: right-click Kite → Open → Open.) | Kite opens on the sign-in page with the Kite lockup. The Dock shows the Kite icon (a placeholder version of the logo). |
| 1.4 | Sign in. | The dashboard appears. |

## 2. Permissions (4 min)

| # | Do | Expect |
|---|---|---|
| 2.1 | Create a session (any type, invented details) and open it. Click **Connect**. | macOS asks to let Kite use the **microphone**, with Kite's reason ("Kite listens to your side of the call…"). Allow it. |
| 2.2 | For the other side, Kite asks to record the screen and system audio. | macOS asks for **Screen & System Audio Recording** permission, with Kite's reason. Allow it in System Settings, then quit and reopen Kite if macOS asks. |
| 2.3 | Click **Connect** again. | Both meters (You and Them) move when you speak and when the video plays. |

## 2b. Home panel (v1.1.0, 1 min)

| # | Do | Expect |
|---|---|---|
| 2b.1 | Open Kite. | A small panel opens first, with your sessions. **⋮** has Zoom, Theme and Private. Kite is in the Dock. |
| 2b.2 | Click the Dock icon with the panel closed. | The panel comes back. |

## 3. Live call (4 min)

| # | Do | Expect |
|---|---|---|
| 3.1 | With headphones on, play a YouTube interview and speak a sentence yourself. | "You" and "Them" lines appear separately. |
| 3.2 | Press **Answer** (or **⌘+Enter**). | An answer streams within about 2 seconds. |
| 3.3 | Click into another app (Notes), then press **⌘+Enter**. | Kite answers; Notes keeps focus. |
| 3.4 | Press **Compact view**. | A small window floats above other apps. |

### During the call (v1.1.0)

| # | Do | Expect |
|---|---|---|
| 3b.1 | Look at the bars, then open both panels. | The window fits them and grows downward. The background is see-through. |
| 3b.2 | Drag the bars by the move handle, and let go on a place along the top. | Three places light up while you drag; **macOS reports a move throughout a drag**, so the bars snap a moment after you let go. Note if this feels wrong. |
| 3b.3 | **⌘+Shift+Space**. | Chat opens with the keyboard. |

## 4. Screen-share protection (3 min)

| # | Do | Expect |
|---|---|---|
| 4.1 | With **Hidden from screen share** on, share your whole screen in Google Meet in Chrome, and look from your phone or the other participant. | Write down what you see. Electron's documentation warns that recent macOS versions and apps built on ScreenCaptureKit may still capture protected windows, so this is a measurement, not a pass or fail. |
| 4.2 | Turn it to **Visible in screen share**. | The compact window is visible to the other side. |

## 5. Quit and uninstall (1 min)

| # | Do | Expect |
|---|---|---|
| 5.1 | Quit Kite (**⌘+Q**). | Kite closes. |
| 5.2 | Drag Kite from Applications to the Bin. Optionally delete `~/Library/Application Support/Kite` to remove its local data. | Kite is gone. |

**Send the developer:** the ✅/❌ list, the macOS version, the Mac model, and a phone photo of step 4.1.
