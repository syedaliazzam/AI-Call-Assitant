# Using Paramount AI (version 1.2.0)

Paramount AI listens to your call, shows a live transcript, and writes a short answer you can say when you press a key. It runs in the **desktop app** (Windows) or in **Chrome or Edge** at **call.paramountintelligence.co**. To install the desktop app, download it from [Paramount AI releases](https://github.com/Zainpak123/kite-releases/releases/latest).

**Used the old address in your browser?** It still works, but your sessions are stored under the address you used them on, so they won't appear at the new one by themselves, and you'll need to sign in there. To bring them over, go to **Settings** on the old address and choose **Export my data**, then **Import data** on the new one. Nothing is duplicated. The desktop app isn't affected.

## Use it where AI assistance is allowed

Use Paramount AI in calls where AI assistance is allowed — your own meetings, client calls, practice and mock interviews. Don't use it to get hidden help in interviews, exams or assessments where outside help isn't permitted. Screen-share protection only hides Paramount AI's windows; it does nothing against monitoring or proctoring tools. Recording or transcribing others may require their consent.

## Between calls: the home panel (desktop app)

The desktop app opens as a small panel: your sessions, newest first, with a search box and a sort button. Each card shows the date, title, description, type, whether the transcript is saved, and its status. **Start** shows what the call will use (company, role, CV, documents, language, model and answer preferences), then **Continue** begins it; **View transcript** opens an ended one.

- **View in dashboard** and **Create session** open the full pages in a larger window.
- **⋮** has your email, **Dashboard**, **Get help**, **Private** (see below), **Zoom**, **Theme** (Light, Dark or System) and **Log out**.
- Drag the header's move button to move the panel, and any edge to resize it. Paramount AI remembers where you left it.

## Before a call: create a session

1. Choose **Create session**, or the arrow beside it to pick the type first.
2. **Details:** the call type, the company or topic, your role, the other person's name if you like (it shows on their lines), a short description or a job link, and the documents Paramount AI should use (a CV, a price list, a runbook). Add **key terms** (names, product words) so the transcript spells them right; it also recognises spoken numbers, such as "BM twenty five" for BM25.
3. **Preferences:** the answer language, the model, your own AI instructions, and **Answer preferences**: format, length (Short ≈ 10–20 s of speech, Balanced ≈ 20–40 s, Detailed ≈ 40–60 s) and tone, with a sample that changes as you choose. **STAR structure** shapes behavioural answers as Situation, Task, Action and Result, from what your CV says. You can change your defaults for new sessions in **Settings**.

Your sessions, documents, transcripts and answers are stored **on this computer only**. Audio never leaves it.

### Starting from the browser

When you start a session in the browser, **Choose platform** asks where to run it. **Open in browser** starts it there. **Desktop app** opens the desktop app; it does not need anything else if the session was made there.

Browsers and the desktop app keep separate data, so a session made in the browser reaches the desktop app as a file. For desktop calls, creating the session in the desktop app is fastest. Use the hand-off only for sessions made in the browser.

1. Choose **Desktop app**. The browser saves `paramount-ai-session-<short id>.json` to your downloads.
2. Choose **Open Paramount AI** in the browser's prompt, or **Open in desktop app** on the page.
3. The desktop app asks for that file: **Choose the file**. Afterwards it offers **Delete the hand-off file**, ticked by default; it deletes only the file you chose. Choosing a newer file for the same session replaces the older copy.

## During a call

1. Start the session, and **Connect call session** opens. Paramount AI listens on two channels: **You** (your microphone) and **Them** (the other person).
   - **Desktop app:** it hears the other person through system audio; there is no picker.
   - **Browser:** share the tab the call is in when Chrome or Edge asks. Turn on **Also share tab audio**.
2. Choose **Connect**. A short sound check shows level bars for You and Them.
3. Choose **Go live**. The transcript fills in, oldest at the top and newest at the bottom.
4. When they ask a question, press **Answer** (**Ctrl+Enter**). The answer streams in: one line you can say as it is, 2 to 4 short points, and sometimes a **Tip**.

Paramount AI answers real questions. If the latest words are a greeting or "say yes when you're ready", it goes back to the last real question. If the words were noise, it says so: press **Answer** again, or type the question. To answer a greeting anyway, press **Answer this** on that line.

### The bars (desktop app)

During a call the desktop app is a set of slim bars over your screen, with panels that open under them.

**Bar 1:**

- **Screen audio and microphone:** a red dot means it is capturing. Each **▾** shows that side's source; the microphone's chooses which one to use.
- **Answer** (**Ctrl+Enter**), **Screenshot** (**Ctrl+Shift+Enter**) and **Chat** (**Ctrl+Shift+Space**).
- **Move:** drag the bar. While you drag, three places light up along the top of the screen: drop on one to go there. **Ctrl+Alt+Arrow** nudges the bars, **Ctrl+Alt+H** shows or hides them, and each screen remembers its own place.
- **Compact** shrinks everything to a small square with moving level bars. Drag it to move it; click it to bring the bars back. The shortcuts keep working, and an answer starting brings the bars back by itself.
- The **timer**, **⋮**, and **Exit**, which asks first.

**Bar 2** has the **level button**, which opens the transcript panel, the answer **language**, **Clear** (**Ctrl+Shift+Backspace**, clears the words on screen) and collapse, with the latest words below: **Listening…** until someone speaks, and their question, highlighted, when they ask one. To its right, **Auto answer** turns on or off answering finished questions by itself.

If you are on a desktop app older than 1.2.0, compact collapses to bar 1 instead, and Ctrl+Alt+Enter works only while Paramount AI has focus.

### The chat bar

**Chat** (**Ctrl+Shift+Space**) opens a bar under bar 1. Type and press **Enter**, or:

- **Ctrl+Alt+Enter** sends your message with a screenshot of your screen. With nothing typed, it just takes the screenshot.
- **Ctrl+Shift+Space twice** opens the bar with the microphone on. Speak, and your words are sent after 1.5 seconds of silence. **Esc** cancels.

**Auto** decides who the answer is for, **For the call** gives an answer you can say, and **Ask AI** gives a private answer for you only.

### The transcript panel

You on the right, the other person on the left, each with their name (or "Client 1") and the time underneath. It follows the newest line; scroll up to read and it stops, with **Scroll to bottom** to go back. Questions show **Answer this**. Lines that are only noise collapse into **Unclear speech**: press it to see them.

### The answer panel

It opens by itself when an answer starts, with the question at once and **Thinking…** until the words arrive. **Stop** ends an answer early.

- The question, then the line to say in bold, then the points. A figure Paramount AI could not find in your documents is underlined: check it before you say it.
- The footer has copy, 👍 / 👎 and report on the left, and the question type, how it was asked and the time on the right. Ratings help it learn your preferences (see **Settings → What Paramount AI has learned**).
- **Ctrl+Left / Ctrl+Right** move between this call's questions. **Clear** (**Ctrl+Backspace**) goes back to the newest answer; it never empties the card.
- A question asked twice within a minute shows once, with the newest answer.
- Drag the grip at the bottom right to resize.

With both panels open they sit side by side, and the window widens for them when the screen has room. It remembers which were open. They are see-through; **⋮ → Opacity** sets how much (40–100 %, 82 % by default). The text always stays solid. Over a bright page, a lower value makes text harder to read.

### The ⋮ menu during a call

Your email, **Dashboard** and **Get help** (in their own window, so the call keeps going), **Private**, **Zoom**, **Theme**, **Opacity**, **Answer text size**, **Language**, **Auto answer**, **Answer preferences**, **Edit session**, **Open call window** (the full view, for when you want everything large) and **Reset position**.

### Coding questions

From a screenshot or a typed question: the **approach** in one line, **Key steps**, **code** in your coding language with its own copy button, **Complexity**, and one line on how to explain it.

### Sending a screenshot

**Screenshot** (**Ctrl+Shift+Enter**): Paramount AI works out what is on your screen and answers to suit, together with what they just asked:

- a coding problem: as above;
- code with an error: the cause, the fix and corrected code;
- a slide or document: its key points and how to respond;
- a table or chart: the takeaway and key numbers;
- something it cannot read: it says so.

### The browser view

During a call the browser view fills the whole window; the sidebar comes back when the call ends. It shows the call side by side from 1280 px wide, and stacked on smaller screens:

- **Left, top:** a large live preview of the shared tab, with **Change tab** (share another tab without ending the call) and **Minimize** (open the overlay) in its corner.
- **Left, under the preview:** **Stop**, **Clear**, the audio levels and the answer **Language**, then the transcript.
- **Right, top:** the session and its status, the call timer, the **⋮** menu (**Theme**, **Larger text**, **Smaller text**, **Auto answer**, **Edit session** in a new tab, answer preferences, **Clear answers**) and **End**.
- **Right:** your answers as cards, newest at the top, the message box with its microphone, and the big **Answer** and **Screenshot** buttons. The arrow on the window's right edge hides or shows this side.
- Drag the divider to resize the two sides. It remembers where you left it.
- The shortcuts work while the tab has focus; only the desktop app has them everywhere.

### Private

**Private** (in each **⋮** menu and in Settings) leaves **all of Paramount AI's windows** out of screen shares: the bars, panels, call window, home panel and Ask AI. It is one setting, off by default. Windows 10 version 2004 or later; on macOS, some capture apps may still show them. Paramount AI stays in your taskbar, and it does nothing against monitoring or proctoring tools.

### If nobody seems to be there

After 10 minutes with nothing from the other person and no answers, it asks **Still in a call?**. After 30, it pauses listening, with a **Resume** button. If your speakers keep repeating the other person into your microphone, it hides those lines and suggests headphones, once.

### If the transcript stops

If sound arrives but no words appear for 8 seconds, speech recognition restarts by itself and **Transcription restarted** shows. The call and its transcript continue.

## After a call

Choose **Exit** (**End** in the browser). The transcript is saved (if **Save transcript** is on for the session), and call notes can be written. Open the session to read them.

The **Transcript** section has two tabs. **Conversation** is the call as a chat, with the speaker above each turn and an answered chip that opens each answer where it was asked. **Answers** lists every answer as a card. A session with several calls shows a divider between them. **Download** gives the conversation as TXT or PDF.

## Ask AI

**Ask AI** (**Ctrl+Alt+K**) is a private assistant for anything: general questions, maths, code. Its answers are for you, not for the call, and are kept on this computer.

## Hotkeys

| Action | Keys | Works |
|---|---|---|
| Answer | Ctrl+Enter | Any app, during a call |
| Screenshot | Ctrl+Shift+Enter | Any app, during a call |
| Chat (twice for the microphone) | Ctrl+Shift+Space | Any app, during a call |
| Send chat with a screenshot | Ctrl+Alt+Enter | While the chat bar is open |
| Script bar | Ctrl+Alt+S | Any app, during a call |
| Show or hide the bars | Ctrl+Alt+H | Any app, during a call |
| Move the bars (add Shift for bigger steps) | Ctrl+Alt+Arrows | Any app, during a call |
| Open Ask AI | Ctrl+Alt+K | Any app, while the desktop app runs |
| Previous or next answer | Ctrl+Left / Right | Paramount AI in front |
| Clear answer | Ctrl+Backspace | Paramount AI in front |
| Clear transcript | Ctrl+Shift+Backspace | Paramount AI in front |

On macOS, Ctrl is ⌘. In a browser, all of them work while the tab has focus.

## Settings

- **Accurate transcription:** **Auto** (the default) uses it when plugged in and not on battery, once its 661 MB model is downloaded; that download never starts by itself. **On** and **Off** are there too.
- **Defaults for new sessions**, **Answers** (format, length, tone, model, coding language, what to do when your CV has no example, your own AI instructions).
- **Overlay:** Private, opacity and how far it fades away from the pointer.
- **Hotkeys:** see and check every shortcut. On keyboards where Ctrl+Alt types a letter (AltGr), it tells you if a shortcut clashes.
- **What Paramount AI has learned:** the lessons it has picked up from your ratings; remove any you do not want.
- **Export my data** and **Local data** (delete everything stored on this computer).
- **Administrators only:** **Answers → Answer style version.** **v-current** (the default) keeps your real CV projects exactly as the CV states them and gives extra depth as your approach. **v-previous** is the earlier answer style, kept so it can be switched back if needed. Under **Admin → Usage**, the **Claude Sonnet 5.5** switch makes the deeper model available; while it is off, sessions set to it use Claude Haiku 5.5.

## Honest answers

Paramount AI answers from your session details, documents and the call. It does not invent prices, personal numbers or results. When something is not in your documents, it gives your approach or says you will confirm after the call, and a private **Note:** line tells you what to check. Always read an answer before you say it.
