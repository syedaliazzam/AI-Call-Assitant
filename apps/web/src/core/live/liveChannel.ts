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
  /** The answer line (first line). */
  headline: string;
  /** The bullets. */
  bullets: string[];
  /** The closing tip to say, or ''. */
  tip: string;
  /** A private note for the user, not to be said, or ''. */
  note: string;
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
}

/** A command without details. */
export interface SimpleCommand {
  /**
   * 'answer': answer the latest question; 'screenshot': answer from a screenshot;
   * 'clear': stop or clear the answer; 'prev' / 'next': move through the history; 'end': end the
   * call; 'hello': the overlay just opened, send the state.
   */
  type: 'answer' | 'screenshot' | 'clear' | 'prev' | 'next' | 'end' | 'hello';
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

/** A typed question from the compact view. */
export interface ChatCommand {
  /** Command type. */
  type: 'chat';
  /** The question (1–2,000 characters). Never logged. */
  question: string;
}

/** What the compact view can ask the live page to do. */
export type CompactCommand = SimpleCommand | ChatCommand | RateCommand | ReportCommand;

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
  if (command.type === 'chat') {
    return (
      typeof command.question === 'string' &&
      command.question.trim().length > 0 &&
      command.question.length <= 2_000
    );
  }
  return ['answer', 'screenshot', 'clear', 'prev', 'next', 'end', 'hello'].includes(command.type);
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
