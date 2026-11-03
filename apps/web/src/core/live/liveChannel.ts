/**
 * File: apps/web/src/core/live/liveChannel.ts
 * Purpose: The link between a live call's page and its overlay (the compact view; Day 5,
 *          ADR-0029): the live page publishes what the overlay shows (audio status, the latest
 *          words and lines, the answer shown with its place in the history, whether it is
 *          answering or taking a screenshot, a notice, and when the call ended), and the overlay
 *          sends back what the user pressed. One BroadcastChannel per session, so it works between
 *          the desktop app's two windows and with a browser picture-in-picture window.
 * Used by: src/features/live/LiveAnswers.tsx (publishes, takes commands),
 *          src/features/live/CompactLive.tsx (shows, sends commands)
 * Depends on: the browser's BroadcastChannel (injectable for tests)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §7.1;
 *               day-05-overlay-screenshots-notes.md Stages 3–4
 *
 * BroadcastChannel stays inside this browser profile and origin: nothing leaves the computer.
 * Messages are checked before use, and their text is never logged.
 */
import { ANSWER_TYPES, type AnswerMeta, type AnswerType, type TargetChoice } from '@kite/shared';
import type { AnswerStyle } from '@/core/storage/types';

/** A transcript line, as the overlay shows it when the transcript is expanded. */
export interface CompactLine {
  /** The line's id. */
  id: string;
  /** Who said it. */
  speaker: 'you' | 'them';
  /** What was said, in sentence case. */
  text: string;
  /** False while the words are still changing. */
  final: boolean;
  /** Start (Unix ms): the overlay groups lines into bubbles by time (v1.0.2). */
  tStart?: number;
  /** End (Unix ms). */
  tEnd?: number;
}

/** A few of the latest words, as one chip in the overlay's transcript bar. */
export interface CompactChip {
  /** Stable id (Clear hides the chips on screen by their ids). */
  id: string;
  /** Who said them. */
  speaker: 'you' | 'them';
  /** The words. */
  text: string;
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
}

/** An earlier answer of this call, in the list under the answer shown. */
export interface CompactEarlier {
  /** The answer's id. */
  id: string;
  /** The question it answers. */
  question: string;
  /** Its answer line. */
  headline: string;
}

/** Everything the overlay shows. */
export interface CompactState {
  /** Whether each side of the call is coming through. */
  audio: CompactAudio;
  /** The latest words, as chips. */
  chips: CompactChip[];
  /** The latest lines, oldest first (shown when the transcript is expanded). */
  lines: CompactLine[];
  /** The answer shown, or null (none yet, or cleared). */
  answer: CompactAnswer | null;
  /** The call's other answers, newest first (ADR-0030). */
  earlier?: CompactEarlier[];
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
  /** True while the overlay is the slim script bar (v1.0.2; Ctrl+Alt+S or the ⋮ menu). */
  scriptBar?: boolean;
  /** True when spoken questions can be dictated in this call (the microphone is running). */
  dictationSupported?: boolean;
  /** True while a spoken question is being dictated. */
  dictating?: boolean;
  /** Why the last dictation ended without a question (v1.0.3), or null. */
  dictationNotice?: string | null;
  /** When the call connected (Unix ms), for the overlay's call timer (v1.0.3). */
  startedAt?: number;
}

/** A command without details. */
export interface SimpleCommand {
  /**
   * 'answer': answer the latest question; 'screenshot': answer from a screenshot;
   * 'clear': stop or clear the answer; 'prev' / 'next': move through the history; 'end': end the
   * call; 'hello': the overlay just opened, send the state.
   */
  type: 'answer' | 'screenshot' | 'clear' | 'prev' | 'next' | 'end' | 'hello' | 'latest';
}

/** Opens or closes the script bar (v1.0.2). */
export interface ScriptBarCommand {
  /** Command type. */
  type: 'script-bar';
  /** True to show the script bar, false for the full overlay. */
  on: boolean;
}

/** Starts or stops dictating a spoken question (v1.0.2, ADR-0038). */
export interface DictateCommand {
  /** Command type. */
  type: 'dictate';
  /** True to start listening, false to stop. */
  on: boolean;
}

/** A transcript bubble's "Answer this" (v1.0.2). */
export interface AnswerThisCommand {
  /** Command type. */
  type: 'answer-this';
  /** The bubble's words (1–2,000 characters). Never logged. */
  question: string;
  /** Start of the bubble's speech (Unix ms). */
  start: number;
  /** End of the bubble's speech (Unix ms). */
  end: number;
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

/** The chat box's switch, from the overlay. */
export interface ChatTargetCommand {
  /** Command type. */
  type: 'chat-target';
  /** The new choice. */
  target: TargetChoice;
}

/** Shows one of the call's answers, from the list in the overlay. */
export interface ShowCommand {
  /** Command type. */
  type: 'show';
  /** The answer's id. */
  id: string;
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

/** What the compact view can ask the live page to do. */
export type CompactCommand =
  | SimpleCommand
  | ChatCommand
  | RateCommand
  | ReportCommand
  | StyleCommand
  | ChatTargetCommand
  | ShowCommand
  | ReanswerCommand
  | ScriptBarCommand
  | DictateCommand
  | AnswerThisCommand;

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
  if (command.type === 'show') return typeof command.id === 'string';
  if (command.type === 'reanswer') {
    return (
      typeof command.id === 'string' &&
      (ANSWER_TYPES as readonly string[]).includes(
        String((value as { answerType?: unknown }).answerType),
      )
    );
  }
  if (command.type === 'chat' || command.type === 'answer-this') {
    const times = value as { start?: unknown; end?: unknown };
    return (
      typeof command.question === 'string' &&
      command.question.trim().length > 0 &&
      command.question.length <= 2_000 &&
      (command.type === 'chat' || (Number.isFinite(times.start) && Number.isFinite(times.end)))
    );
  }
  if (command.type === 'script-bar' || command.type === 'dictate') {
    return typeof (value as { on?: unknown }).on === 'boolean';
  }
  return ['answer', 'screenshot', 'clear', 'prev', 'next', 'end', 'hello', 'latest'].includes(
    command.type,
  );
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
    Array.isArray(state.lines) &&
    (state.answer === null || typeof state.answer?.headline === 'string')
  );
}

/**
 * Opens the link for a session.
 *
 * @param sessionId The session id.
 * @param open      Creates the channel (default: a BroadcastChannel).
 * @returns The link.
 * Called from: LiveAnswers.tsx, CompactLive.tsx; tests
 */
export function openLiveChannel(
  sessionId: string,
  open: (name: string) => ChannelPort = (name) => new BroadcastChannel(name),
): LiveChannel {
  const port = open(channelName(sessionId));
  const stateListeners: ((state: CompactState) => void)[] = [];
  const commandListeners: ((command: CompactCommand) => void)[] = [];
  port.onmessage = (event: MessageEvent) => {
    const message = event.data as Partial<Message> | null;
    if (message?.kind === 'state' && isState(message.state)) {
      for (const listener of stateListeners) listener(message.state);
    } else if (message?.kind === 'command' && isCommand(message.command)) {
      for (const listener of commandListeners) listener(message.command);
    }
  };
  return {
    publish: (state) => port.postMessage({ kind: 'state', state } satisfies Message),
    send: (command) => port.postMessage({ kind: 'command', command } satisfies Message),
    onState: (listener) => stateListeners.push(listener),
    onCommand: (listener) => commandListeners.push(listener),
    close: () => {
      port.onmessage = null;
      port.close();
    },
  };
}
