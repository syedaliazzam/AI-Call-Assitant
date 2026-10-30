/**
 * File: apps/web/src/core/live/liveChannel.ts
 * Purpose: The link between a live call's page and its compact view (Day 5): the live page
 *          publishes what the compact view shows (the latest transcript line, the latest answer,
 *          whether it is answering or taking a screenshot, a notice, and when the call ended), and the compact view sends back what the user pressed (Answer,
 *          Screenshot, Clear, a typed question). One BroadcastChannel per session, so it works
 *          between the desktop app's two windows and with a browser picture-in-picture window.
 * Used by: src/features/live/LiveAnswers.tsx (publishes, takes commands),
 *          src/features/live/CompactLive.tsx (shows, sends commands)
 * Depends on: the browser's BroadcastChannel (injectable for tests)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §7.1;
 *               day-05-overlay-screenshots-notes.md Stages 3–4
 *
 * BroadcastChannel stays inside this browser profile and origin: nothing leaves the computer.
 * Messages are checked before use, and their text is never logged.
 */
/** The latest transcript line, as the compact view shows it. */
export interface CompactLine {
  /** Who said it. */
  speaker: 'you' | 'them';
  /** What was said. */
  text: string;
}

/** The latest answer, as the compact view shows it. */
export interface CompactAnswer {
  /** The headline (first line). */
  headline: string;
  /** The bullets. */
  bullets: string[];
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

/** Everything the compact view shows. */
export interface CompactState {
  /** The latest transcript line, or null. */
  line: CompactLine | null;
  /** The latest answer, or null (none yet, or cleared). */
  answer: CompactAnswer | null;
  /** True while an answer streams. */
  answering: boolean;
  /** True while a screenshot is being taken. */
  capturing: boolean;
  /** A short notice (for example "nothing to answer yet"), or null. */
  notice: string | null;
  /** True once the call has ended (the compact view closes). */
  ended: boolean;
}

/** A command without details: answer, take a screenshot, clear, or ask for the state. */
export interface SimpleCommand {
  /**
   * 'answer': answer the latest question; 'screenshot': answer from a screenshot;
   * 'clear': stop or clear the answer; 'hello': the compact view just opened, send the state.
   */
  type: 'answer' | 'screenshot' | 'clear' | 'hello';
}

/** A typed question from the compact view. */
export interface ChatCommand {
  /** Command type. */
  type: 'chat';
  /** The question (1–2,000 characters). Never logged. */
  question: string;
}

/** What the compact view can ask the live page to do. */
export type CompactCommand = SimpleCommand | ChatCommand;

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
  const command = value as Partial<{ type: string; question: unknown }> | null;
  if (!command || typeof command.type !== 'string') return false;
  if (command.type === 'chat') {
    return (
      typeof command.question === 'string' &&
      command.question.trim().length > 0 &&
      command.question.length <= 2_000
    );
  }
  return ['answer', 'screenshot', 'clear', 'hello'].includes(command.type);
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
    (state.line === null || typeof state.line?.text === 'string') &&
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
