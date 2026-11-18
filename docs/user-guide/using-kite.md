# Using Paramount AI (version 1.5.0)

Paramount AI listens to your call, shows a live transcript, and writes a short answer you can say when you press a key. It runs in the **desktop app** (Windows) or in **Chrome or Edge** at **call.paramountintelligence.co**. To install the desktop app, download it from [Paramount AI releases](https://github.com/Zainpak123/kite-releases/releases/latest).

**If you see "Windows protected your PC":** click **More info** → **Run anyway**. If Smart App Control blocks it, use the browser version at [https://call.paramountintelligence.co](https://call.paramountintelligence.co), or ask IT.

**Your sessions are in your account:** the same sessions, documents, answers and notes on every browser and computer you sign in on, including the old address (sign in there once). The first time a browser or the desktop app still holds sessions from before, it asks **Add your sessions to <your email>?** once: **Add** copies them into your account.

## Use it where AI assistance is allowed

Use Paramount AI in calls where AI assistance is allowed — your own meetings, client calls, practice and mock interviews. Don't use it to get hidden help in interviews, exams or assessments where outside help isn't permitted. Screen-share protection only hides Paramount AI's windows; it does nothing against monitoring or proctoring tools. Record a meeting only when everyone on it has agreed; recording or transcribing others may require their consent.

**Recording a meeting:** tell everyone on the call before you record, and record only when they agree. Some places require everyone's consent; recording without it may be against the law. Paramount AI asks you to confirm this every time a recording starts.

## Between calls: the desktop app

The desktop app has no dashboard of its own: creating, editing and reviewing sessions happen in your browser at **call.paramountintelligence.co**, and every **Dashboard** or **Open dashboard** button opens it there. The app opens on **Your sessions**: the same sessions as the dashboard, newest first, each with its logo, company, role, date and status. After a call, **Call ended · View notes** sits on top.

1. Click a session (**Start**, or **Start again** for one you have used before).
2. **Connect Call Session** opens straight away: the audio source (system audio), **Everyone on the call has agreed to be recorded** (tick it if you may record this call; see **Recording a meeting**), three tips (Zoom's setting, checking Private, a mock interview to practise on), then **Connect**. The first time, it downloads the speech model (about 204 MB) once.
3. The bars appear on top of your meeting; the app's window steps aside.

- **⋮** has your email, **Dashboard**, **Get help**, **Private** (see below), **Zoom**, **Theme** (Light, Dark or System; Light until you change it) and **Log out**.
- Drag the header's move button to move the window. Paramount AI remembers where you left it.

## Before a call: create a session

1. Choose **Create session**, or the arrow beside it to pick the type first.
2. **Details:** the call type, the company (after two letters it suggests companies from your past sessions, then others with their logos; pick one, or keep typing any name), the topic, your role, a short description or a job link, and the documents Paramount AI should use (a CV, a price list, a runbook). Under **Advanced** at the bottom, add **key terms** (names, product words) so the transcript spells them right; it also recognises spoken numbers, such as "BM twenty five" for BM25.
3. **Preferences:** the answer language, the model, your own AI instructions, and **Answer preferences**: format, length (Short ≈ 10–20 s of speech, Balanced ≈ 20–40 s, Detailed ≈ 40–60 s) and tone, with a sample that changes as you choose. **STAR structure** shapes behavioural answers as Situation, Task, Action and Result, from what your CV says. You can change your defaults for new sessions in **Settings**.

Your sessions, documents, answers and notes are kept in your account, so they appear on every device you sign in on. A transcript is kept only when **Save transcript** is on. Call audio is streamed to Deepgram to turn speech into text and is never stored; if Deepgram cannot be reached, speech is turned into text on your computer.

### Starting from the browser

When you start a session in the browser, **Choose platform** asks where to run it. **Open in browser** starts it there. **Desktop app** opens the desktop app (1.3.0 or later):

1. Choose **Desktop app**, then **Open Paramount AI** in the browser's prompt.
2. The app comes forward on **Your sessions** with that session first, marked **From your browser**, signed in. If it is signed in to another account, it asks **Switch to …?** first.

## During a call

1. Start the session, and **Connect call session** opens. Paramount AI listens on two channels: **You** (your microphone) and **Them** (the other person).
   - **Desktop app:** it hears the other person through system audio; there is no picker.
   - **Browser:** share the tab the call is in when Chrome or Edge asks. Turn on **Also share tab audio**.
2. **Browser:** check the **You** level bar (it moves when you speak); press **Test microphone** first. **Desktop app:** the microphone is chosen on bar 1 (**▾**) once the call is on.
3. Choose **Connect**. The call starts at once: the overlay opens and the transcript fills in, oldest at the top and newest at the bottom.
4. When they ask a question, press **Ctrl+Enter** (Answer). The answer streams in: one line you can say as it is, 2 to 4 short points, and sometimes a **Tip**.
5. To ask your own question, press **Ctrl+Shift+Space** and say it. The status bar shows **Listening…**; the answer starts as soon as you stop speaking, and **Esc** cancels. If you pause to think and then go on, the rest still belongs to the same question: the card is asked again with the whole question. Words you were saying just before the press stay in the transcript and are not part of the question. Your question is not added to the transcript and does not count as your reply. **Ctrl+Alt+Enter** does the same with a screenshot taken first, sent together with your question. If listening was paused ("Still in a call?"), the shortcut starts it again. In the desktop app the shortcut works from any app; in the browser, keep the Paramount AI tab in front.

Paramount AI answers real questions. If the latest words are a greeting or "say yes when you're ready", it goes back to the last real question. If the words were noise, it says so: press **Ctrl+Enter** again, or ask the question with **Ctrl+Shift+Space**. To answer a greeting anyway, press **Answer this** on that line.

### The bars (desktop app)

During a call the desktop app is a set of slim bars over your screen, with panels that open under them.

**Bar 1:**

- **Screen audio and microphone:** a red dot means it is capturing. Each **▾** shows that side's source; the microphone's chooses which one to use.
- **Move:** the bars have six places: top left, top centre, top right, and the same along the bottom, 16 px from the screen's edges (never under the taskbar). **Ctrl+Shift+Left / Right** jumps one place along the row, **Ctrl+Shift+Up / Down** to the top or bottom row (desktop app 1.7.0; before it, Ctrl+Alt+Arrows), and **Ctrl+Alt+Shift+Arrows** nudges them a little. Dragging the bar shows the six places; let go and the bars go to the nearest one. **⋮ → Position** has the same six as a small grid. On the bottom row everything is mirrored: the bars sit at the bottom and the panels and menus open above them. **Ctrl+Alt+H** shows or hides the bars, and each screen remembers its own place.
- **Transcript:** the **Transcript** switch on bar 1, or **Ctrl+Alt+T** while the bars have focus, turns the live transcript on or off. It is open when a call starts the first time, then stays as you last left it. The switch never leaves the bar, however narrow the window or large the zoom (it becomes an icon when space is short).
- **Rec** (desktop app 1.5.0): records the meeting; see **Recording a meeting**.
- **Auto answer** turns on or off answering finished questions by itself.
- **Model** (the chip next to Auto, or **⋮ → Model**): **GPT-5.6 Luna** (fast), **GPT-5.6 Terra**, **Claude Haiku** (the default), **Claude Sonnet** (more thorough and slower) or **Groq** (fastest). It applies from the next answer. With Groq, answers from a screenshot use Claude; the GPT models answer screenshots themselves. If Groq or a GPT model has a problem or doesn't start an answer within 4 seconds, Claude Haiku answers it instead. An admin can turn Sonnet, Groq or the GPT models off. Accounts in the Gemini trial also see **Gemini 3.5 Flash Lite** and **Gemini 3.6 Flash** (these answer screenshots too, and fall back to Claude Haiku the same way).
- **Voice** (the waveform, or **⋮ → Voice**): talk to Paramount AI hands-free. While it is on, each time you finish a question it is sent and the answer shows; then it keeps listening. Your words aren't added to the transcript and don't count as your reply. A short sound from the other side ("mm-hmm", a noise) changes nothing; when the other person really starts speaking, what you had already said is sent, and Voice pauses until 2 seconds after they finish. It is off at the start of every call; **Esc** (with Paramount AI in front) or the toggle turns it off. **Mute yourself in the meeting first if others can hear you.**
- **Click-through** (**Ctrl+Alt+X**): when it is lit, clicks and typing outside the bars go to the app behind; see **Click-through**.
- **Compact** shrinks everything to a small square with moving level bars. Drag it to move it; click it to bring the bars back. The shortcuts keep working, and an answer starting brings the bars back by itself.
- The **timer**, **⋮**, and **Exit**, which ends the call and closes the bars at once.

There are no Answer, Screenshot or Chat buttons on the bars: use **Ctrl+Enter**, **Ctrl+Shift+Enter**, **Ctrl+Shift+Space** and **Ctrl+Alt+Enter** (see **Hotkeys**).

**The status bar** (bar 2) is one line: the **level button** (opens or closes the transcript panel), then the line itself, then **Clear** (**Ctrl+Shift+Backspace**, clears the words on screen) and collapse. The line shows the latest words (**Listening…** until someone speaks, and their question, highlighted, when they ask one), or, when something needs you, that message with its button: **Can't hear the other side · Choose audio source**, **Can't hear your microphone · Choose microphone**, **Speakers echoing — use headphones · OK**, **Listening… (Esc cancels) · Cancel**, **Still in a call? · Yes**. With the transcript panel open, the same bar is the panel's top row. Collapsed to bar 1, a warning that needs you still brings the status bar back.

The bars open at about 40 % of your screen's width (desktop app 1.6.5; at least 640 and at most 960 px), and with panels open they grow up to about half its height; drag an edge to change it, and Paramount AI remembers. **Zoom** (**Ctrl+=**, **Ctrl+-**, **Ctrl+0**, or **⋮ → Zoom**, 80–130 %) makes the whole window bigger or smaller with everything in the same place: it grows from the corner or edge it sits at and never leaves the screen, and **Ctrl+0** brings back the exact size you chose. During a call the zoom keys work from any app, so pressing them in the meeting app zooms the bars. The call's language is the session's (set it in **Edit session**); the bars have no language control. If you are on a desktop app older than 1.2.0, compact collapses to bar 1 instead.

### The transcript panel

It reads like an Otter export: each turn starts with the speaker's name and the time since the call started (for example **Dana  04:12**), with the words on the next line. Your turns show your account's name; the other person's show the name you gave them in Review, or "Them". One person's lines stay in one turn until the other person speaks or there is a pause of more than 8 seconds. It follows the newest line; scroll up to read and it stops, with **Scroll to bottom** to go back. Questions show **Answer this**. Lines that are only noise collapse into **Unclear speech**: press it to see them.

### The answer panel

It opens by itself when an answer starts, with the question at once and **Thinking…** until the words arrive. **Stop** ends an answer early.

- The question, then the line to say in bold, then the points. A figure Paramount AI could not find in your documents is underlined: check it before you say it.
- The footer has copy, 👍 / 👎 and report on the left, and the question type, how it was asked and the time on the right. Ratings help it learn your preferences (see **Settings → What Paramount AI has learned**).
- **←** and **→** (**Ctrl+Left / Ctrl+Right**) move between this call's questions. **Clear** (**Ctrl+Backspace**) clears the answers from the screen; new answers show as usual, and every answer stays in the session's review.
- A question asked twice within a minute shows once, with the newest answer.
- Drag the grip at the bottom right to resize.

With both panels open the transcript is on the left and the answer on the right, side by side when the window is wide enough (600 px), and one above the other when it is not. Drag the thin bar between them to give one more room (or use the arrow keys after clicking it); double-click it to go back to 40 / 60. One panel on its own fills the width. The answer panel opens by itself for each call's first answer. Each panel is only as tall as what it shows, and the window ends where the panels end: click beside or below a panel and the click goes to the app behind it, Word or your notes. New lines and answers never take the keyboard, and after you click a panel button (copy, ← →, a switch) the keyboard goes back to the app you were in. It remembers whether the transcript was open. They are see-through; **⋮ → Opacity** sets how much (40–100 %, 82 % by default). The text always stays solid. Over a bright page, a lower value makes text harder to read.

### The ⋮ menu during a call

Your email, **Dashboard** and **Get help** (in their own window, so the call keeps going), **Private**, **Zoom** (also **Ctrl+=**, **Ctrl+-** and **Ctrl+0**), **Theme** (for the call windows only, Dark until you change it), **Opacity**, **Answer text size**, **Recording type** (desktop app 1.5.0: **Screen + audio** or **Audio only**, for the **Rec** pill), **Auto answer**, **Click-through** (see below), **Answer preferences**, **Edit session**, **Open call window** (the full view, for when you want everything large) and **Position** (the six places, the current one highlighted; **Reset position** in desktop apps before 1.3.0).

### Coding questions

From a screenshot or your own question: the **approach** in one line, **Key steps**, **code** in your coding language with its own copy button, **Complexity**, and one line on how to explain it.

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

### Click-through

**Click-through** (the **Click-through** switch on bar 1, **⋮**, or **Ctrl+Alt+X**) lets you work in the app behind the overlay with the panels open: every click, scroll and key outside the bars goes to that app. The panels keep updating, and the shortcuts keep working. The bars still take clicks, so you can always turn it off with the mouse: the switch is lit while it is on; click it, or press **Ctrl+Alt+X** again.

### Private

**Private** (in each **⋮** menu and in Settings) leaves **all of Paramount AI's windows** out of screen shares: the bars, panels, call window, home panel and Ask AI. It is one setting, and it is turned **on at the start of every call, before the bars appear**; you can turn it off in **⋮** for that call, and the status bar then says **Private is off: the overlay shows in screen shares · Turn on**. Tooltips, menus and lists are drawn inside Paramount AI's windows, so they are left out too. Windows' own icons (the microphone-in-use icon, the taskbar button) and your mouse pointer are not Paramount AI's windows and can show. Windows 10 version 2004 or later; on macOS, some capture apps may still show them. Paramount AI stays in your taskbar, and it does nothing against monitoring or proctoring tools.

Test it with your phone before a real call:

1. Turn **Private** on (**⋮** → **Private**).
2. Start a meeting on the computer (Google Meet in Chrome, Teams or Zoom) and join the same meeting on your phone.
3. On the computer, share your **entire screen**.
4. Open Paramount AI's bars, both panels and a **⋮** menu, then look at the phone.

None of Paramount AI's windows should show on the phone; the rest of your screen does. In Zoom's default capture mode a black box may show where they are: see **Zoom** below. Turn **Private** off and look again: now they show.

### Zoom

Zoom leaves Paramount AI's windows out of a share only when it captures with window filtering:

1. Update Zoom to its latest version.
2. In Zoom, open **Settings** → **Share Screen** → **Advanced** → **Screen capture mode**, and choose **Advanced capture with window filtering**.

Without it, the people in the call may see a black box where Paramount AI's windows are. Test it with your phone, as above.

### Recording a meeting (desktop app 1.5.0)

Paramount AI can record your meeting like a Zoom or Meet recording: your whole screen with both sides' sound, or the sound only. **Recordings stay on your computer**, in **Documents › Paramount AI › Recordings**. They are never uploaded; your account keeps only a small record (date, length, size, file name, which computer) so the **Meetings** page can list them.

- Recording starts only from the **Rec** pill on the bars (after **Transcript**), or **Ctrl+Alt+R**; a call never records by itself. The type (**Screen + audio** or **Audio only**) is in **⋮ → Recording type**.
- If you ticked **Everyone on the call has agreed to be recorded** on the **Connect Call Session** card, **Rec** starts recording at once. Otherwise it asks **Everyone has agreed to be recorded?**; **Start recording** starts it (with several monitors, pick the screen there). While it records, the pill is red and shows the time (**● Rec 4:07**). Press it again (or **Ctrl+Alt+R**) and **Stop recording**. Starting again in the same call makes a new **part** of the same meeting.
- **Private comes on** when a screen recording starts, so Paramount AI's windows and answers stay out of the video (you can turn it off in **⋮**).
- **Exit** stops the recording. Afterwards **Recording saved · Open in Meetings** shows in the app's window.
- If the app or the computer stops during a recording, what was recorded is kept: the next start finishes the file, and **Meetings** shows it as recovered.
- About **0.3 GB an hour** at Standard quality (720p), **0.9 GB** at High (1080p, Settings → Recording). A recording does not start with less than about 2 GB free, warns when space runs low, and stops by itself at 300 MB.
- When **Save transcript** is off, the video is kept but the separate sound file for re-transcription is not.
- The files are not encrypted by Paramount AI. Turn on **BitLocker** (Windows) or **FileVault** (macOS) so a lost laptop does not expose them.

**Meetings** (in the sidebar of the dashboard) lists every recorded meeting with its session, date, length, size, parts and **Saved on** the computer that holds it. **Open in desktop app** opens Paramount AI's player on that computer: the video with the transcript beside it (click a line to jump there), **Save as…** (the file as recorded, or an MP4 copy), **Open folder** and **Delete** (to the Recycle Bin). On another computer there is nothing to download: the recording is only where it was made. Rename this computer on the **Meetings** page in the desktop app. Deleting a session removes its recordings from **Meetings**; the files stay in the Recordings folder until you delete them.

### If nobody seems to be there

After 10 minutes with nothing from the other person and no answers, it asks **Still in a call?**. After 30, it pauses listening, with a **Resume** button. If your speakers keep repeating the other person into your microphone, it hides those lines and suggests headphones, once; it also suggests them at the start of a call when your sound plays through speakers. Headphones give the cleanest transcript, but they are never required.

**Auto answer** waits for the whole question: about a second after a question that sounds finished, three seconds after one that stops mid-sentence ("…and what would you change about"). If the other person carries on just after it started, the same answer card is answered again with the whole question. It never answers "can you repeat that?", "can you hear me?" or greetings. Speech in another language shows as **[non-English speech]** and is not answered. If you press **Answer** on something that asks nothing ("let me pull up my notes", "can you hear me?"), Kite says it wasn't a question and makes no card.

### If the transcript stops

If sound arrives but no words appear for 8 seconds, speech recognition restarts by itself and **Transcription restarted** shows. The call and its transcript continue.

## After a call

Choose **Exit** (**End** in the browser). The transcript is saved (if **Save transcript** is on for the session), and call notes can be written. Open the session to read them.

The **Transcript** section has two tabs. **Conversation** reads like an Otter export: each turn has the speaker's name and the time since the call started, then the words. Each answer sits right after the turn it answered, as **Paramount AI answered** with its time, with the question and the answer shown below it; click it to fold them away. Click the other person's name to rename them: the name is kept with the session and used in the panel and the downloads. **Answers** lists every answer as a card. A session with several calls shows a divider between them. **Download** gives the conversation as TXT or PDF in the same layout, with every answer written out in full. When **Save transcript** was off, the file has the answers only.

**Call details** lists the **Words Paramount AI listens for**: the names and terms transcription is told to expect. Your **Key terms** come first, then your first name and the other person's name, the company, the role and names from your documents. If a name keeps coming out wrong, add it with **Edit key terms**.

### Saving to Google Drive

With Google Drive connected (**Settings → Google Drive**), each call's folder gets three files: **Transcript.pdf** (not when **Save transcript** is off), **Notes.pdf**, and the recording (**Part 1.mkv**, one file per part) when you recorded the call. An email tells you when they are saved. The stereo sound file is still kept on this computer, but it is not uploaded. Calls saved before this change keep the files they already have in Drive, and **Upload to Drive** for an older call never uploads a file twice.

## Ask AI

**Ask AI** (**Ctrl+Alt+K**) is a private assistant for anything: general questions, maths, code. Its answers are for you, not for the call, and are kept on this computer.

## Hotkeys

| Action | Keys | Works |
|---|---|---|
| Answer | Ctrl+Enter | Any app, during a call |
| Answer from a screenshot | Ctrl+Shift+Enter | Any app, during a call |
| Voice question: speak, sent as soon as you stop (Esc cancels) | Ctrl+Shift+Space | Any app, during a call (desktop app); the Paramount AI tab (browser) |
| Screenshot and voice question | Ctrl+Alt+Enter | Any app, during a call |
| Previous or next answer | Ctrl+Left / Right | Any app, during a call (desktop app 1.6.4) |
| Clear answers | Ctrl+Backspace | Any app, during a call (desktop app 1.6.4) |
| Clear transcript | Ctrl+Shift+Backspace | Any app, during a call (desktop app 1.6.4) |
| Zoom the bars in, out, back to 100 % | Ctrl+= / Ctrl+- / Ctrl+0 | Any app, during a call (desktop app 1.6.4) |
| Script bar | Ctrl+Alt+S | Any app, during a call |
| Click-through on or off | Ctrl+Alt+X | Any app, during a call |
| Start or stop recording (asks first) | Ctrl+Alt+R | Any app, during a call (desktop app 1.5.0) |
| Show or hide the bars | Ctrl+Alt+H | Any app, during a call |
| Move the bars to the next place (← → along the row, ↑ ↓ top or bottom row) | Ctrl+Shift+Arrows | Any app, during a call (desktop app 1.7.0; before it Ctrl+Alt+Arrows) |
| Nudge the bars | Ctrl+Alt+Shift+Arrows | Any app, during a call |
| Transcript on or off | Ctrl+Alt+T | While the bars have focus |
| Open Ask AI | Ctrl+Alt+K | Any app, while the desktop app runs (during a call it opens in its own window) |

On macOS, Ctrl is ⌘. In a browser, all of them work while the tab has focus. While a call runs in the desktop app (1.6.4), the keys above belong to Paramount AI: for example **Ctrl+Backspace** does not delete a word in another app until the call ends. With an older desktop app, previous / next, the two Clears and zoom work only while Paramount AI is in front. **Ctrl+Shift+Arrows** selects text by word in other apps, so it too belongs to Paramount AI only while a call runs.

## Settings

- **Accurate transcription** (desktop app): **On** by default, on battery too. A second engine rewrites the other person's lines a moment after they appear, and Paramount AI answers from those words. Your own lines are rewritten after the call, when the transcript is saved. The 661 MB model downloads by itself in the background after the app starts, and the home screen shows its progress. Calls work meanwhile with the standard transcription. Choose **Only when plugged in** to save battery, or **Off** to skip it and its download.
- **Defaults for new sessions**, **Answers** (format, length, tone, model, coding language, what to do when your CV has no example, your own AI instructions).
- **Privacy → Company suggestions:** on by default. The company name you type, and the websites of companies you pick, go to Brandfetch to suggest names and show logos. Off: nothing goes to Brandfetch, only your past sessions are suggested, and session cards show a letter instead of a logo.
- **Overlay:** Private, opacity and how far it fades away from the pointer.
- **Recording** (desktop app 1.5.0): the video quality (Standard 720p, or High 1080p where the computer has a hardware video encoder), where the files go, and the advice to turn on BitLocker.
- **Hotkeys:** see and check every shortcut. On keyboards where Ctrl+Alt types a letter (AltGr), it tells you if a shortcut clashes.
- **What Paramount AI has learned:** the lessons it has picked up from your ratings; remove any you do not want.
- **Export my data** and **Local data** (delete everything stored on this computer).
- **Administrators only:** **Answers → Answer style version.** **v-current** (the default) keeps your real CV projects exactly as the CV states them and gives extra depth as your approach. **v-previous** is the earlier answer style, kept so it can be switched back if needed. Under **Admin → Usage**, the **Claude Sonnet 5.5** switch makes the deeper model available; while it is off, sessions set to it use Claude Haiku 5.5.

## Honest answers

Paramount AI answers from your session details, documents and the call. It does not invent prices, personal numbers or results. When something is not in your documents, it gives your approach or says you will confirm after the call, and a private **Note:** line tells you what to check. Always read an answer before you say it.
