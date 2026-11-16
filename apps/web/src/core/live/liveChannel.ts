/**
 * File: apps/web/src/core/live/liveChannel.ts
 * Purpose: The link between a live call's page and its overlay (the compact view; Day 5,
 *          ADR-0029): the live page publishes what the overlay shows (audio status, the latest
 *          words, the live question, the answer shown with its place in the history, whether it is
 *          answering or taking a screenshot, a notice, and when the call ended), and the overlay
 *          sends back what the user pressed. One BroadcastChannel per session, so it works between
 *          the desktop app's two windows and with a browser picture-in-picture window. v1.1.0
 *          (ADR-0041): also the transcript's bubbles, the audio levels and the stacked overlay's
 *          commands. Desktop 1.5.0 (ADR-0068): the meeting recording's state and its Rec pill's commands.
 *          ADR-0094: the answer model in use (and whether Smart is allowed), and the overlay's model switch.
 * Used by: src/features/live/LiveAnswers.tsx (publishes, takes commands),
 *          src/features/live/CompactLive.tsx (shows, sends commands)
 * Depends on: the browser's BroadcastChannel (injectable for tests)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §7.1;
 *               day-05-overlay-screenshots-notes.md Stages 3–4
 *
 * BroadcastChannel stays inside this browser profile and origin: nothing leaves the computer.
 * Messages are checked before use, and their text is never logged.
 */
import {
  ANSWER_TYPES,
  RECORDING_KINDS,
  type AnswerMeta,
  type AnswerType,
  type RecordingDisplay,
  type RecordingKind,
  type TargetChoice,
} from '@kite/shared';
import type { CallNotice } from './callNotice';
import type { AnswerModel, AnswerStyle } from '@/core/storage/types';

/** A few of the latest words, as one chip in the overlay's transcript bar. */
export interface CompactChip {
  /** Stable id (Clear hides the chips on screen by their ids). */
  id: string;
  /** Who said them. */
  speaker: 'you' | 'them';
  /** The words. */
  text: string;
}

/** One transcript bubble for the overlay's transcript panel (v1.1.0). */
export interface CompactGroup {
  /** Stable id (the bubble's first line). */
  id: string;
  /** Who spoke. */
  speaker: 'you' | 'them';
  /** The finished words, ready to show. */
  finalText: string;
  /** Words that may still change, or ''. */
  provisionalText: string;
  /** When it started (Unix ms). */
  tStart: number;
  /** v1.3.2: when it ended (Unix ms), so the panel can merge turns; absent from an older live page. */
  tEnd?: number;
  /** True for a "Them" bubble that holds a question. */
  question: boolean;
  /** True when this speech has been answered. */
  answered: boolean;
  /** True when its words look like noise (it collapses into "Unclear speech"; ADR-0044). */
  unclear: boolean;
}

/** Audio levels, 0 to 1, sent on their own because they change many times a second (v1.1.0). */
export interface CompactLevels {
  /** The microphone. */
  you: number;
  /** The other side. */
  them: number;
}

/** Whether each side of the call is coming through. */
export interface CompactAudio {
  /** The microphone is connected. */
  you: boolean;
  /** The other side's audio is connected. */
  them: boolean;
}

/** The answer shown, as the overlay shows it. */
export interface CompactAnswer {
  /** The answer's id. */
  id: string;
  /** The question it answers ('' when Claude was asked to answer the latest "Them" lines). */
  question: string;
  /** The question as Claude cleaned it up, once it has arrived (v1.0.2, ADR-0037). */
  cleanQuestion?: string;
  /** The answer's text so far: the overlay shows it with AnswerBody, the same as the main window. */
  text: string;
  /** The answer line (first line); empty until it has arrived. */
  headline: string;
  /** Its question type, target and source, once they have arrived (ADR-0030). */
  meta?: AnswerMeta;
  /** Words the claim check could not find, to underline (ADR-0030). */
  claims: string[];
  /** When it was asked (Unix ms). */
  askedAt: number;
  /** The user's rating. */
  rating: 'up' | 'down' | null;
  /** True once the user has reported it. */
  reported: boolean;
  /** True when Kite answered by itself (auto-answer). */
  auto: boolean;
  /** Streaming, finished, failed or cancelled. */
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  /** How it was asked. */
  mode: 'answer' | 'chat' | 'screenshot';
  /**
   * When it failed: what to show (the "Claude is unavailable" message, or "The answer failed."
   * with the reason; core/answer/unavailable.ts). Null otherwise.
   */
  error: string | null;
  /** True when it failed because Claude is unavailable for everyone (usage limit or overload). */
  unavailable: boolean;
  /**
   * Batch C (P1-4, ADR-0076 E3 rule 2): the press gave up waiting for the other side's last words, so the
   * question may be incomplete (the overlay card says so, as the call window's does). Absent otherwise.
   */
  incomplete?: boolean;
  /**
   * Batch D (P1-G): part of the other person's audio was lost around the question (the overlay card says so,
   * as the call window's does). Absent otherwise.
   */
  audioLost?: boolean;
}

/**
 * The meeting recording, as the call bars show it (desktop 1.5.0, ADR-0068). Absent from an older live
 * page, and where this app cannot record (the bars then show no Rec pill).
 */
export interface CompactRecording {
  /** Off, starting, recording, or stopping (finalising the files). */
  state: 'off' | 'starting' | 'on' | 'stopping';
  /** When the part being recorded started (Unix ms), or null. */
  startedAt: number | null;
  /** The type the next start uses (the ⋮ menu's "Recording type"). */
  kind: RecordingKind;
  /** The displays (a picker shows in the Start popover when there are several). */
  displays: RecordingDisplay[];
  /** The display picked for the next screen recording, or null for the main one. */
  displayId: string | null;
  /** True when the session saves its transcript (the stereo file is kept); false shows a warning. */
  stereo: boolean;
  /** Grows each time Ctrl+Alt+R is pressed, so the bars open the Start or Stop question. */
  promptCount: number;
  /** How many parts this call has recorded so far. */
  parts: number;
  /** A short notice (Private turned on, low disk, a stop or failure), or null. */
  notice: string | null;
  /**
   * ADR-0082: true when "Everyone on the call has agreed to be recorded" was ticked at Connect for this call:
   * the Rec pill then starts recording at once, without asking again. Absent (older pages): it asks.
   */
  consented?: boolean;
}

/** Everything the overlay shows. */
export interface CompactState {
  /** Whether each side of the call is coming through. */
  audio: CompactAudio;
  /** The latest words, as chips. */
  chips: CompactChip[];
  /** The latest question from the other person, updating live (v1.0.4), or null when none. */
  liveQuestion?: string | null;
  /** The answer shown, or null only when the call has no answers yet (v1.0.4, ADR-0040). */
  answer: CompactAnswer | null;
  /** The chat box's switch: Auto, For the call or Ask Kite (ADR-0030). */
  chatTarget?: TargetChoice;
  /** Grows each time the Ask Kite shortcut is pressed, so the overlay opens its chat box. */
  askKiteCount?: number;
  /** The session's type, for the source tag's words. */
  sessionType?: string;
  /** The answer's place in this call's history, from 0 (-1 when none is shown). */
  index: number;
  /** How many answers the history holds. */
  total: number;
  /** True while an answer streams. */
  answering: boolean;
  /** True while a screenshot is being taken. */
  capturing: boolean;
  /** A short notice (for example "nothing to answer yet"), or null. */
  notice: string | null;
  /** True once the call has ended (the compact view closes). */
  ended: boolean;
  /** How answers are written now; the overlay's menu can change it during a call. */
  style?: AnswerStyle;
  /**
   * ADR-0094: the model the next answer uses ('fast' = Claude Haiku, 'smart' = Claude Sonnet); the ⋮ menu's
   * Model row and bar 1's chip can change it during a call. 'fast' when the session asks for the deeper
   * model but an admin has turned it off (the server answers with the fast one then). Absent from an older
   * live page: the overlay then shows no model choice.
   */
  model?: AnswerModel;
  /** ADR-0094: false when an admin has turned the deeper model off (Smart is shown disabled). */
  smartAllowed?: boolean;
  /** True while the overlay is the slim script bar (v1.0.2; Ctrl+Alt+S or the ⋮ menu). */
  scriptBar?: boolean;
  /**
   * v1.3.2: Click-through is on (the ⋮ menu or Ctrl+Alt+X): outside the bars every click and key goes to
   * the app behind the overlay. The live page holds it, like the script bar.
   */
  clickThrough?: boolean;
  /** True when spoken questions can be dictated in this call (the microphone is running). */
  dictationSupported?: boolean;
  /** True while a spoken question is being dictated. */
  dictating?: boolean;
  /** Why the last dictation ended without a question (v1.0.3), or null. */
  dictationNotice?: string | null;
  /** When the call connected (Unix ms), for the overlay's call timer (v1.0.3). */
  startedAt?: number;
  /** v1.1.0: the latest transcript bubbles, oldest first. */
  groups?: CompactGroup[];
  /**
   * v1.1.0: the name on the other person's turns. ADR-0093: the call's name for them, else the session's,
   * else "Interviewer" (interviews) or "Them".
   */
  themName?: string;
  /**
   * ADR-0093: a name the other person gave when introducing themselves, offered as "Rename Them to
   * Sarah?" (one click; never applied by itself). Absent when there is nothing to offer.
   */
  nameOffer?: string;
  /** v1.1.0: the answer language's code. */
  language?: string;
  /** v1.1.0: whether Kite answers finished questions by itself in this call. */
  autoAnswer?: boolean;
  /** v1.1.0: "Still in a call?" (ask) or listening paused (paused); ADR-0044. */
  hygiene?: 'ok' | 'ask' | 'paused';
  /** v1.1.0: true to show the one-time "Use headphones" hint (ADR-0044). */
  headphonesHint?: boolean;
  /**
   * 1.5.1 (ADR-0069): a notice about what the call hears (core/live/callNotice.ts): a silent channel, with
   * its device list's button, or the speech worker catching up; absent when there is none.
   */
  callNotice?: CallNotice;
  /**
   * ADR-0076 (G4): the Answer shortcut's label when another app holds it (the overlay then warns for the
   * whole call); absent otherwise.
   */
  answerKeyTaken?: string;
  /** v1.1.0: the session's id, for Edit session. */
  sessionId?: string;
  /** v1.1.0: the microphone in use ('' for the system's default). */
  micDeviceId?: string;
  /** v1.1.0: where "Them" comes from, in words. */
  themSourceLabel?: string;
  /** Desktop 1.5.0 (ADR-0068): the meeting recording, where this app can record. */
  recording?: CompactRecording;
}

/** A command without details. */
export interface SimpleCommand {
  /**
   * 'answer': answer the latest question; 'screenshot': answer from a screenshot;
   * 'clear': stop the answer and go back to the newest one; 'prev' / 'next': move through the
   * history; 'end': end the call; 'hello': the overlay just opened, send the state;
   * 'call-window': open the full call window at the newest answer (v1.0.4, ADR-0040);
   * v1.1.0: 'stop': stop the answer streaming, keeping what arrived; 'clear-transcript': clear the
   * words on screen; 'still-here': yes, still in a call; 'resume': listen again after a pause;
   * 'headphones-seen': the hint was closed. Desktop 1.5.0 (ADR-0068): 'record-stop': stop recording
   * (after the Stop question); 'record-notice-seen': the recording notice was closed; 'record-prompt':
   * Ctrl+Alt+R pressed while the overlay had focus (the bars then ask Start or Stop). ADR-0076 (G4):
   * 'hotkey-settings': open Settings at Hotkeys (the Answer shortcut is held by another app). ADR-0082:
   * 'clear' clears the answers on screen (Ctrl+Backspace, the answer panel's Clear); 'voice-cancel': Escape
   * while a voice question listens. ADR-0093: 'dismiss-name': "Not now" on the rename offer.
   */
  type:
    | 'answer'
    | 'screenshot'
    | 'clear'
    | 'prev'
    | 'next'
    | 'end'
    | 'hello'
    | 'call-window'
    | 'stop'
    | 'clear-transcript'
    | 'still-here'
    | 'resume'
    | 'headphones-seen'
    | 'record-stop'
    | 'record-notice-seen'
    | 'record-prompt'
    | 'hotkey-settings'
    | 'voice-cancel'
    | 'dismiss-name';
}

/**
 * ADR-0082: a voice question, from the overlay's own key handling (Ctrl+Shift+Space, or Ctrl+Alt+Enter for
 * the screenshot first). Pressed while one listens, it cancels.
 */
export interface VoiceCommand {
  /** Command type. */
  type: 'voice';
  /** True to take a screenshot first and send it with the spoken question. */
  screenshot: boolean;
}

/** Answers one transcript bubble, from the overlay's transcript panel (v1.1.0). */
export interface AnswerThisCommand {
  /** Command type. */
  type: 'answer-this';
  /** The bubble's id. */
  groupId: string;
}

/** Changes the answer language, from the overlay (v1.1.0). */
export interface LanguageCommand {
  /** Command type. */
  type: 'language';
  /** The language's code. */
  code: string;
}

/**
 * ADR-0094: the model for this session's next answers, from the overlay's ⋮ menu or bar 1's chip. An answer
 * already streaming finishes on the model it started with.
 */
export interface ModelCommand {
  /** Command type. */
  type: 'model';
  /** 'fast' (Claude Haiku) or 'smart' (Claude Sonnet). */
  model: AnswerModel;
}

/** Turns auto-answer on or off for this call, from the overlay's menu (v1.1.0). */
export interface AutoAnswerCommand {
  /** Command type. */
  type: 'auto-answer';
  /** True to turn it on. */
  on: boolean;
}

/** Switches the microphone, from the overlay's device list (v1.1.0). */
export interface MicCommand {
  /** Command type. */
  type: 'mic';
  /** The device's id ('' for the system's default). */
  deviceId: string;
}

/** Opens or closes the script bar (v1.0.2). */
export interface ScriptBarCommand {
  /** Command type. */
  type: 'script-bar';
  /** True to show the script bar, false for the full overlay. */
  on: boolean;
}

/** Turns Click-through on or off (v1.3.2). */
export interface ClickThroughCommand {
  /** Command type. */
  type: 'click-through';
  /** True to let clicks and keys outside the bars go to the app behind. */
  on: boolean;
}

/** ADR-0093: accepts the offered name for the other person, for the rest of this call. */
export interface RenameThemCommand {
  /** Command type. */
  type: 'rename-them';
  /** The name offered (the live page checks it is the one it offered). */
  name: string;
}

/** Starts or stops dictating a spoken question (v1.0.2, ADR-0038). */
export interface DictateCommand {
  /** Command type. */
  type: 'dictate';
  /** True to start listening, false to stop. */
  on: boolean;
}

/** A rating from the overlay. */
export interface RateCommand {
  /** Command type. */
  type: 'rate';
  /** The answer's id. */
  id: string;
  /** The rating, or null to remove it. */
  rating: 'up' | 'down' | null;
}

/** A report from the overlay. */
export interface ReportCommand {
  /** Command type. */
  type: 'report';
  /** The answer's id. */
  id: string;
  /** What was wrong ('' when the user wrote nothing). Never logged. */
  note: string;
}

/** New answer preferences from the overlay's menu. */
export interface StyleCommand {
  /** Command type. */
  type: 'style';
  /** How the next answers should be written. */
  style: AnswerStyle;
}

/** A typed question from the compact view. */
export interface ChatCommand {
  /** Command type. */
  type: 'chat';
  /** The question (1–2,000 characters). Never logged. */
  question: string;
}

/** Asks about a screenshot of the screen with a typed question (v1.2.0, spec S14). */
export interface ChatScreenshotCommand {
  /** Command type. */
  type: 'chat-screenshot';
  /** The question (1–2,000 characters). Never logged. */
  question: string;
}

/** The chat box's switch, from the overlay. */
export interface ChatTargetCommand {
  /** Command type. */
  type: 'chat-target';
  /** The new choice. */
  target: TargetChoice;
}

/** Answers again in another shape, from the answer card's menu. */
export interface ReanswerCommand {
  /** Command type. */
  type: 'reanswer';
  /** The answer's id. */
  id: string;
  /** The question type chosen. */
  answerType: AnswerType;
}

/**
 * Starts recording (desktop 1.5.0, ADR-0068), after the person said everyone agreed (the Rec pill's or
 * Ctrl+Alt+R's question). The type is the ⋮ menu's.
 */
export interface RecordStartCommand {
  /** Command type. */
  type: 'record-start';
  /** The display to record (screen recordings), or null for the main one. */
  displayId: string | null;
}

/** Sets the type later recordings in this call use (the ⋮ menu; remembered on this device). */
export interface RecordKindCommand {
  /** Command type. */
  type: 'record-kind';
  /** Screen and sound, or sound only. */
  kind: RecordingKind;
}

/** What the compact view can ask the live page to do. */
export type CompactCommand =
  | SimpleCommand
  | ChatCommand
  | ChatScreenshotCommand
  | RateCommand
  | ReportCommand
  | StyleCommand
  | ChatTargetCommand
  | ReanswerCommand
  | ScriptBarCommand
  | ClickThroughCommand
  | DictateCommand
  | VoiceCommand
  | AnswerThisCommand
  | LanguageCommand
  | AutoAnswerCommand
  | ModelCommand
  | MicCommand
  | RecordStartCommand
  | RecordKindCommand
  | RenameThemCommand;

/** One message on the channel. */
type Message =
  | {
      /** A state update from the live page. */
      kind: 'state';
      /** The state. */
      state: CompactState;
    }
  | {
      /** A command from the compact view. */
      kind: 'command';
      /** The command. */
      command: CompactCommand;
    }
  | {
      /** The audio levels from the live page (v1.1.0). */
      kind: 'levels';
      /** The levels. */
      levels: CompactLevels;
    };

/** The parts of a BroadcastChannel used here (a fake in tests). */
export interface ChannelPort {
  /** Sends a message to the other windows. */
  postMessage(message: unknown): void;
  /** Receives messages. */
  onmessage: ((event: MessageEvent) => void) | null;
  /** Closes the channel. */
  close(): void;
}

/** The link, from either side. */
export interface LiveChannel {
  /**
   * Publishes the state (live page).
   *
   * @param state What the compact view should show.
   */
  publish(state: CompactState): void;
  /**
   * Publishes the audio levels (live page; v1.1.0). Separate from the state: they change many times
   * a second and only the level bars need them.
   *
   * @param levels The levels.
   */
  publishLevels(levels: CompactLevels): void;
  /**
   * Sends a command (compact view).
   *
   * @param command What the user pressed.
   */
  send(command: CompactCommand): void;
  /**
   * Listens for state updates (compact view).
   *
   * @param listener Called with each state.
   */
  onState(listener: (state: CompactState) => void): void;
  /**
   * Listens for the audio levels (compact view; v1.1.0).
   *
   * @param listener Called with each update.
   */
  onLevels(listener: (levels: CompactLevels) => void): void;
  /**
   * Listens for commands (live page).
   *
   * @param listener Called with each command.
   */
  onCommand(listener: (command: CompactCommand) => void): void;
  /** Stops listening. */
  close(): void;
}

/**
 * The channel name for a session.
 *
 * @param sessionId The session id.
 * @returns The BroadcastChannel name.
 * Called from: openLiveChannel(); tests
 */
export function channelName(sessionId: string): string {
  return `kite-live-${sessionId}`;
}

/**
 * Whether a value is a valid command.
 *
 * @param value A received value.
 * @returns True for a CompactCommand.
 * Called from: openLiveChannel(); tests
 */
export function isCommand(value: unknown): value is CompactCommand {
  const command = value as Partial<{
    type: string;
    question: unknown;
    id: unknown;
    rating: unknown;
    note: unknown;
  }> | null;
  if (!command || typeof command.type !== 'string') return false;
  if (command.type === 'rate') {
    return (
      typeof command.id === 'string' &&
      (command.rating === 'up' || command.rating === 'down' || command.rating === null)
    );
  }
  if (command.type === 'report') {
    return (
      typeof command.id === 'string' &&
      typeof command.note === 'string' &&
      command.note.length <= 2_000
    );
  }
  if (command.type === 'style') {
    const style = (value as { style?: Partial<AnswerStyle> | null }).style;
    return (
      !!style &&
      ['headline+bullets', 'bullets', 'paragraph'].includes(String(style.format)) &&
      ['short', 'medium', 'detailed'].includes(String(style.length)) &&
      ['simple', 'professional', 'technical'].includes(String(style.tone))
    );
  }
  if (command.type === 'chat-target') {
    return ['auto', 'call', 'kite'].includes(String((value as { target?: unknown }).target));
  }
  if (command.type === 'reanswer') {
    return (
      typeof command.id === 'string' &&
      (ANSWER_TYPES as readonly string[]).includes(
        String((value as { answerType?: unknown }).answerType),
      )
    );
  }
  if (command.type === 'chat' || command.type === 'chat-screenshot') {
    return (
      typeof command.question === 'string' &&
      command.question.trim().length > 0 &&
      command.question.length <= 2_000
    );
  }
  if (
    command.type === 'script-bar' ||
    command.type === 'click-through' ||
    command.type === 'dictate' ||
    command.type === 'auto-answer'
  ) {
    return typeof (value as { on?: unknown }).on === 'boolean';
  }
  if (command.type === 'voice') {
    return typeof (value as { screenshot?: unknown }).screenshot === 'boolean';
  }
  if (command.type === 'answer-this') {
    return typeof (value as { groupId?: unknown }).groupId === 'string';
  }
  if (command.type === 'language') {
    const code = (value as { code?: unknown }).code;
    return typeof code === 'string' && code.length > 0 && code.length <= 16;
  }
  if (command.type === 'model') {
    const model = (value as { model?: unknown }).model;
    return model === 'fast' || model === 'smart';
  }
  if (command.type === 'mic') {
    const deviceId = (value as { deviceId?: unknown }).deviceId;
    return typeof deviceId === 'string' && deviceId.length <= 256;
  }
  if (command.type === 'record-start') {
    const displayId = (value as { displayId?: unknown }).displayId;
    return displayId === null || (typeof displayId === 'string' && displayId.length <= 64);
  }
  if (command.type === 'rename-them') {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 && name.length <= 200;
  }
  if (command.type === 'record-kind') {
    return (RECORDING_KINDS as readonly unknown[]).includes((value as { kind?: unknown }).kind);
  }
  return [
    'answer',
    'screenshot',
    'clear',
    'prev',
    'next',
    'end',
    'hello',
    'call-window',
    'stop',
    'clear-transcript',
    'still-here',
    'resume',
    'headphones-seen',
    'record-stop',
    'record-notice-seen',
    'record-prompt',
    'hotkey-settings',
    'voice-cancel',
    // ADR-0093: "Not now" on the rename offer.
    'dismiss-name',
  ].includes(command.type);
}

/**
 * Whether a value looks like a state update (the fields the compact view reads).
 *
 * @param value A received value.
 * @returns True for a CompactState.
 * Called from: openLiveChannel(); tests
 */
export function isState(value: unknown): value is CompactState {
  const state = value as Partial<CompactState> | null;
  return (
    !!state &&
    typeof state.answering === 'boolean' &&
    typeof state.capturing === 'boolean' &&
    typeof state.ended === 'boolean' &&
    Array.isArray(state.chips) &&
    (state.answer === null || typeof state.answer?.headline === 'string')
  );
}

/**
 * 1.5.1 (ADR-0069): the overlay gets the call's state at most this often, ms. Before 1.5.1 every grey word
 * and every streamed piece of an answer was sent at once, and the overlay re-rendered for each: it used
 * 0.6–0.9 of a CPU core on the test laptop (0.09 in v1.3.2), taken from the live speech engine. The
 * latest state is always delivered, at most this much later.
 */
export const PUBLISH_EVERY_MS = 200;

/**
 * Batch C (P1-2): whether a state carries the first words of the answer it shows (the last state sent had
 * none for that answer).
 *
 * @param state The state to send.
 * @param sent  The answer in the last state sent (its id, whether it had words), or null.
 * @returns True for the first words.
 * Called from: openLiveChannel() (publish); tests
 */
export function firstWords(
  state: CompactState,
  sent: { id: string; hasText: boolean } | null,
): boolean {
  const answer = state.answer;
  if (!answer || answer.text.trim() === '') return false;
  return sent === null || sent.id !== answer.id || !sent.hasText;
}

/**
 * Opens the link for a session.
 *
 * @param sessionId       The session id.
 * @param open            Creates the channel (default: a BroadcastChannel).
 * @param publishEveryMs  The shortest time between two state messages, ms (default PUBLISH_EVERY_MS;
 *                        0 sends every one at once).
 * @returns The link.
 * Called from: LiveAnswers.tsx, CompactLive.tsx; tests
 */
export function openLiveChannel(
  sessionId: string,
  open: (name: string) => ChannelPort = (name) => new BroadcastChannel(name),
  publishEveryMs = PUBLISH_EVERY_MS,
): LiveChannel {
  const port = open(channelName(sessionId));
  const stateListeners: ((state: CompactState) => void)[] = [];
  const commandListeners: ((command: CompactCommand) => void)[] = [];
  const levelListeners: ((levels: CompactLevels) => void)[] = [];
  port.onmessage = (event: MessageEvent) => {
    const message = event.data as Partial<Message> | null;
    if (message?.kind === 'state' && isState(message.state)) {
      for (const listener of stateListeners) listener(message.state);
    } else if (message?.kind === 'command' && isCommand(message.command)) {
      for (const listener of commandListeners) listener(message.command);
    } else if (
      message?.kind === 'levels' &&
      typeof message.levels?.you === 'number' &&
      typeof message.levels?.them === 'number'
    ) {
      for (const listener of levelListeners) listener(message.levels);
    }
  };
  // The state waiting to be sent, when the last one went out less than publishEveryMs ago.
  let pending: CompactState | null = null;
  let lastSentAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Batch C (P1-2): the answer last sent, and whether it had words yet (its first words go at once).
  let sentAnswer: { id: string; hasText: boolean } | null = null;
  const sendState = (state: CompactState) => {
    lastSentAt = Date.now();
    sentAnswer = state.answer
      ? { id: state.answer.id, hasText: state.answer.text.trim() !== '' }
      : null;
    port.postMessage({ kind: 'state', state } satisfies Message);
  };
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending) {
      const state = pending;
      pending = null;
      sendState(state);
    }
  };
  return {
    publish: (state) => {
      const wait = lastSentAt + publishEveryMs - Date.now();
      // The end of a call is never held back; nor (Batch C, P1-2) an answer's first words, the moment the
      // user is waiting for (later pieces still go at most every publishEveryMs).
      if (wait <= 0 || state.ended || firstWords(state, sentAnswer)) {
        pending = null;
        if (timer) clearTimeout(timer);
        timer = null;
        sendState(state);
        return;
      }
      pending = state;
      timer ??= setTimeout(flush, wait);
    },
    publishLevels: (levels) => port.postMessage({ kind: 'levels', levels } satisfies Message),
    send: (command) => port.postMessage({ kind: 'command', command } satisfies Message),
    onState: (listener) => stateListeners.push(listener),
    onLevels: (listener) => levelListeners.push(listener),
    onCommand: (listener) => commandListeners.push(listener),
    close: () => {
      flush();
      port.onmessage = null;
      port.close();
    },
  };
}
