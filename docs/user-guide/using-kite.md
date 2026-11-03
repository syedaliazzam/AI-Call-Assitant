# Using Kite (version 1.0.0)

Kite listens to your call, shows a live transcript, and writes a short answer you can say when you press a key. It runs in the **desktop app** (Windows) or in **Chrome or Edge**. To install the desktop app, see [Install Kite on Windows](install-windows.md).

## Before a call: create a session

1. On the dashboard, choose **New session**.
2. **Details:** the call type, the company or topic, your role, a short description, and the documents Kite should use (a CV, a price list, a runbook). Add **key terms** (names, product words) so the transcript spells them right; Kite also recognises spoken numbers, such as "BM twenty five" for BM25.
3. **Preferences:** answer format, length (Short ≈ 10–20 s of speech, Balanced ≈ 20–40 s, Detailed ≈ 40–60 s), tone and language. You can change your defaults for new sessions in **Settings**.

Your sessions, documents, transcripts and answers are stored **on this computer only**. Audio never leaves it.

## During a call

1. Open the session and choose **Connect**. Kite listens on two channels: **You** (your microphone) and **Them** (the other person).
   - **Desktop app:** Kite hears the other person through system audio; there is no picker.
   - **Browser:** share the tab the call is in when Chrome or Edge asks. Turn on **Also share tab audio**.
2. Choose **Go live**. The transcript fills in, newest line first.
3. When they ask a question, press **Answer** (**Ctrl+Enter**). The answer streams in: one line you can say as it is, 2 to 4 short points, and sometimes a **Tip**.

### The answer card

- **Question:** what Kite answered, with a copy button.
- **Answer line** in bold, then the points. A figure Kite could not find in your documents is underlined: check it before you say it.
- The footer shows the question type, the time, and 👍 / 👎 to rate the answer. Ratings help Kite learn your preferences (see **Settings → What Kite has learned**).
- **← / →** (**Ctrl+Left / Ctrl+Right**) move between answers. **Clear** (**Ctrl+Backspace**) clears the card.
- If an answer is stopped before any words arrive, the card says so. Press **Answer** to ask again.

### Typing a question or sending a screenshot

- **Chat** (**Ctrl+Shift+Backspace**): type a question. The switch next to the box sends it **for the call** (an answer you can say) or to **Ask Kite** (a private answer for you only).
- **Screenshot** (**Ctrl+Shift+Enter**): Kite reads what is on your screen (a slide, a coding task) and answers about it.

### The browser view

The browser shows the call side by side from 1280 px wide, and stacked on smaller screens:

- **Left:** a live preview of the shared tab with a control strip (**Stop**, **Clear**, the answer **Language**, **Change tab** to share another tab without ending the call, and **Minimize** to the overlay), and the transcript below it.
- **Right:** your answers, the message box, and the big **Answer** and **Screenshot** buttons. The arrow at the top hides or shows this side.
- **Across the top:** the microphone, **Answer**, **Screenshot**, **Chat**, the call timer, **Back to compact**, the **⋮** menu and **End**.
- Drag the divider to resize the two sides. Kite remembers where you left it.

### The overlay (desktop app)

The overlay is a small floating window for answers while you look at the call.

- **Ctrl+Alt+H** shows or hides it. **Ctrl+Alt+Arrow** moves it (add **Shift** for bigger steps).
- **Settings → Overlay** sets how see-through its background is (40–100 %, 70 % by default). The text always stays fully solid. Over a bright page, a lower value makes text harder to read. At the default 70 % the answer text meets the contrast target even over a white page; at 40 % over a white page it does not, so raise the value if you share a bright screen.
- The overlay shows the question the other person just asked, highlighted, above your answer. It updates as they speak.
- **⛶** (or **⋮ → Open call window**, or Kite in the taskbar) opens the **full call window**: the transcript on the left, every answer on the right. **Back to compact** or **Esc** returns to the overlay.
- A question asked twice shows once, with the newest answer.
- The overlay can be hidden from screen sharing, in its **⋮** menu. **The full call window is a normal window: a screen share can show it.** Kite does not hide itself from the taskbar or from monitoring tools.

### If the transcript stops

If sound arrives but no words appear for 8 seconds, Kite restarts speech recognition by itself and shows **Transcription restarted**. The call and its transcript continue.

## After a call

Choose **End**. Kite saves the transcript (if **Save transcript** is on for the session) and can write **call notes**. Open the session from the dashboard to read the transcript, the answers and the notes.

## Ask Kite

**Ask Kite** (**Ctrl+Alt+K**) is a private assistant for anything: general questions, maths, code. Its answers are for you, not for the call, and are kept on this computer.

## Settings

- **Defaults for new sessions**, **Answers** (format, length, tone, model, coding language, what to do when your CV has no example, your own AI instructions).
- **Hotkeys:** see and check every shortcut. On keyboards where Ctrl+Alt types a letter (AltGr), Kite tells you if a shortcut clashes.
- **What Kite has learned:** the lessons Kite has picked up from your ratings; remove any you do not want.
- **Export my data** and **Local data** (delete everything Kite stored on this computer).
- **Administrators only:** **Answers → Answer style version.** **v-current** (the default) keeps your real CV projects exactly as the CV states them and gives extra depth as your approach. **v-previous** is the earlier answer style, kept so it can be switched back if needed.

## Honest answers

Kite answers from your session details, documents and the call. It does not invent prices, personal numbers or results. When something is not in your documents, it gives your approach or says you will confirm after the call, and a private **Note:** line tells you what to check. Always read an answer before you say it.
