/**
 * File: apps/web/src/features/ask-kite/AskKitePage.tsx
 * Purpose: The Ask Kite page: a private chat about anything, outside a call. Chats are stored on
 *          this device. A chat can have items from the Resume and Document libraries or a past
 *          session attached, and screenshots pasted into a message. Voice (item 8): talk instead of
 *          typing (sent when you pause), "Read replies aloud" and "Hands-free" (listen again after
 *          each reply); this page only, outside calls (ADR-0038).
 * Used by: app/(app)/ask-kite/page.tsx
 * Depends on: src/core/askKite/chat.ts, src/core/answer (answerClient.ts, unavailable.ts),
 *             src/core/screenshot/prepare.ts, src/core/storage (chats, library, sessions,
 *             voicePrefs), src/core/review/load.ts, src/core/voice/speak.ts, ./useVoiceInput.ts,
 *             ./VoiceControls.tsx, src/features/answers, src/ui
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md; ADR-0038
 *
 * Questions and answers are only rendered and stored on this device; never logged. Pasted
 * screenshots stay in memory until they are sent, and are not kept afterwards.
 */
'use client';

import {
  MAX_KITE_ATTACHMENTS,
  MAX_KITE_IMAGES,
  MAX_KITE_QUESTION_CHARS,
  type AnswerMeta,
} from '@kite/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { streamAnswer } from '@/core/answer/answerClient';
import { answerFailureText } from '@/core/answer/unavailable';
import {
  chatTitle,
  kiteRequest,
  MAX_ATTACHED_CHARS,
  SCREENSHOT_ONLY,
  sessionAttachment,
} from '@/core/askKite/chat';
import { loadReview } from '@/core/review/load';
import { prepareScreenshot } from '@/core/screenshot/prepare';
import { deleteChat, listChats, newChat, saveChat } from '@/core/storage/chats';
import { listLibrary } from '@/core/storage/library';
import { listSessions } from '@/core/storage/sessions';
import { getHandsFree, getReadAloud, setHandsFree, setReadAloud } from '@/core/storage/voicePrefs';
import { createSpeaker } from '@/core/voice/speak';
import type {
  ChatAttachment,
  ChatMessage,
  LibraryItem,
  Session,
  StoredChat,
} from '@/core/storage/types';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { AnswerTags } from '@/features/answers/AnswerTags';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { PageShell } from '@/ui/PageShell';
import { useVoiceInput } from './useVoiceInput';
import { MicButton, VoiceOptions } from './VoiceControls';

/**
 * Nothing to subscribe to: the stored voice switches and the browser's speech support do not
 * change by themselves while the page is open (the page's own state takes over once changed).
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/** What can be attached, as shown in the dialog. */
interface AttachChoices {
  /** The Resume library. */
  resumes: LibraryItem[];
  /** The Document library. */
  documents: LibraryItem[];
  /** Past sessions, newest first. */
  sessions: Session[];
}

/** A screenshot pasted into the message being written. In memory only. */
interface PastedImage {
  /** Random id. */
  id: string;
  /** The prepared JPEG, as a data URL. */
  dataUrl: string;
}

/**
 * One message of the chat.
 *
 * @param props.message The message.
 * @param props.streaming True while it is still arriving.
 * @returns The message.
 * Rendered by: AskKitePage
 */
function Message({
  message,
  streaming = false,
}: {
  /** The message. */
  message: ChatMessage;
  /** True while it is still arriving. */
  streaming?: boolean;
}) {
  if (message.role === 'you') {
    return (
      <li aria-label="You asked" className="flex max-w-[85%] flex-col items-end self-end">
        <span className="whitespace-pre-wrap rounded-control bg-ui-pale px-3 py-1.5 text-[15px] text-ui-text">
          {message.text}
        </span>
        {message.images ? (
          <span className="mt-0.5 text-[13px] text-ui-muted">
            {message.images} {message.images === 1 ? 'screenshot' : 'screenshots'}, not kept
          </span>
        ) : null}
      </li>
    );
  }
  return (
    <li
      aria-label="Paramount AI answered"
      className="border border-ui-border rounded-card bg-ui-surface shadow-card p-3"
    >
      <AnswerBody text={message.text} target="kite" size="chat" />
      {!streaming && (
        <div className="mt-2">
          <AnswerTags meta={message.meta} />
        </div>
      )}
    </li>
  );
}

/**
 * The Ask Kite page.
 *
 * @returns The page.
 * Rendered by: app/(app)/ask-kite/page.tsx
 */
export function AskKitePage() {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [chat, setChat] = useState<StoredChat>(() => newChat());
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<PastedImage[]>([]);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [choices, setChoices] = useState<AttachChoices | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Voice (item 8, ADR-0038). This page is never open during a call (leaving the live page ends
  // it), so reading aloud cannot be picked up as the other side or reach a meeting.
  const [speaker] = useState(() => createSpeaker());
  const canSpeak = useSyncExternalStore(subscribeNever, speaker.supported, () => false);
  const [speaking, setSpeaking] = useState(false);
  // The stored switches are read after hydration (the server has no localStorage); a change on
  // the page then takes over.
  const storedReadAloud = useSyncExternalStore(subscribeNever, getReadAloud, () => false);
  const storedHandsFree = useSyncExternalStore(subscribeNever, getHandsFree, () => false);
  const [readAloudChoice, setReadAloudChoice] = useState<boolean | null>(null);
  const [handsFreeChoice, setHandsFreeChoice] = useState<boolean | null>(null);
  const readAloud = canSpeak && (readAloudChoice ?? storedReadAloud);
  const handsFree = handsFreeChoice ?? storedHandsFree;
  // The latest send() and switches, for callbacks that run later (a pause, the end of a reply).
  const sendRef = useRef<(spoken?: string) => void>(() => undefined);
  const voiceRef = useRef({ readAloud, handsFree });
  useEffect(() => {
    voiceRef.current = { readAloud, handsFree };
  });
  const voice = useVoiceInput({
    onPreview: setDraft,
    onSend: (text) => sendRef.current(text),
  });
  const startListening = voice.start;

  // A request still running when the page closes is stopped: nobody would read it. Reading aloud
  // stops too.
  useEffect(
    () => () => {
      cancel.current?.();
      speaker.stop();
    },
    [speaker],
  );

  /**
   * After a reply: read it aloud if that is on, then (hands-free) listen for the next message.
   *
   * @param text The finished reply.
   * @returns Nothing.
   */
  const afterReply = useCallback(
    (text: string) => {
      const { readAloud: read, handsFree: again } = voiceRef.current;
      if (read) {
        setSpeaking(true);
        speaker.speak(text, {
          onEnd: () => {
            setSpeaking(false);
            if (voiceRef.current.handsFree) startListening('');
          },
        });
      } else if (again) {
        startListening('');
      }
    },
    [speaker, startListening],
  );

  /** Stops reading the reply; hands-free then listens, as if the reading had ended. */
  function stopSpeaking() {
    speaker.stop();
    setSpeaking(false);
    if (handsFree) startListening('');
  }

  const reload = useCallback(() => {
    listChats()
      .then(setChats)
      .catch(() => setNotice('Paramount AI could not open its local storage. Reload the page.'));
  }, []);
  useEffect(reload, [reload]);

  // Keep the newest words in view while an answer arrives.
  const messageCount = chat.messages.length;
  const replyLength = reply?.text.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messageCount, replyLength]);

  /**
   * Keeps a chat on screen and saves it, if it has anything worth keeping.
   *
   * @param next The chat.
   * @returns Nothing.
   */
  function store(next: StoredChat) {
    setChat(next);
    if (next.messages.length === 0) return;
    saveChat(next)
      .then(reload)
      .catch(() => setNotice('The chat could not be saved on this computer (is the disk full?).'));
  }

  /**
   * Sends the message being written, or the one just dictated.
   *
   * @param spoken The dictated message (the microphone sends it on a pause); default the box.
   * @returns Nothing.
   */
  function send(spoken?: string) {
    const question = (spoken ?? draft).trim();
    if ((!question && images.length === 0) || reply) return;
    setNotice(null);
    // A new message stops reading the last reply, and a typed one stops the microphone.
    speaker.stop();
    setSpeaking(false);
    if (spoken === undefined) voice.stop();
    const pasted = images.map((image) => image.dataUrl);
    const mine: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'you',
      text: question || SCREENSHOT_ONLY,
      at: Date.now(),
      ...(pasted.length > 0 ? { images: pasted.length } : {}),
    };
    const request = kiteRequest(chat, question, pasted);
    const sent: StoredChat = {
      ...chat,
      title: chat.messages.length === 0 ? chatTitle(question) : chat.title,
      messages: [...chat.messages, mine],
      updatedAt: mine.at,
    };
    store(sent);
    setDraft('');
    setImages([]);
    const answerId = crypto.randomUUID();
    let text = '';
    let meta: AnswerMeta | undefined;
    setReply({ id: answerId, role: 'kite', text: '', at: Date.now() });
    const running = streamAnswer(request, {
      onMeta: (received) => {
        meta = received;
      },
      onDelta: (piece) => {
        text += piece;
        setReply({ id: answerId, role: 'kite', text, at: Date.now() });
      },
      onDone: () => {
        cancel.current = null;
        setReply(null);
        const at = Date.now();
        store({
          ...sent,
          updatedAt: at,
          messages: [
            ...sent.messages,
            { id: answerId, role: 'kite', text, at, ...(meta ? { meta } : {}) },
          ],
        });
        afterReply(text);
      },
      onError: (failure) => {
        cancel.current = null;
        setReply(null);
        setNotice(answerFailureText(failure).text);
      },
    });
    cancel.current = running.cancel;
  }
  // The microphone's pause calls the newest send() (with this render's chat and draft).
  useEffect(() => {
    sendRef.current = send;
  });

  /**
   * Enter sends; Shift+Enter starts a new line.
   *
   * @param event The key press in the box.
   */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  /**
   * Takes a pasted screenshot out of the clipboard and prepares it. Pasted text is left to the box.
   *
   * @param event The paste.
   */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    for (const file of files) {
      if (images.length + files.indexOf(file) >= MAX_KITE_IMAGES) {
        setNotice(`At most ${MAX_KITE_IMAGES} screenshots in one message.`);
        break;
      }
      prepareScreenshot(file)
        .then((prepared) =>
          setImages((current) => [
            ...current,
            { id: crypto.randomUUID(), dataUrl: prepared.dataUrl },
          ]),
        )
        .catch((error: unknown) =>
          setNotice(
            error instanceof Error ? error.message : 'Paramount AI could not read that image.',
          ),
        );
    }
  }

  /** Opens the attach dialog and reads what can be attached. */
  function openAttach() {
    setAttachOpen(true);
    Promise.all([listLibrary('resume'), listLibrary('document'), listSessions()])
      .then(([resumes, documents, sessions]) => setChoices({ resumes, documents, sessions }))
      .catch(() => setNotice('Paramount AI could not open its local storage. Reload the page.'));
  }

  /**
   * Attaches a copy of something to the chat, if it fits.
   *
   * @param item What to attach.
   * @returns Nothing.
   */
  function attach(item: Omit<ChatAttachment, 'id'>) {
    setAttachOpen(false);
    const used = chat.attachments.reduce((total, current) => total + current.text.length, 0);
    if (chat.attachments.length >= MAX_KITE_ATTACHMENTS) {
      setNotice(`At most ${MAX_KITE_ATTACHMENTS} attachments in one chat.`);
      return;
    }
    if (used + item.text.length > MAX_ATTACHED_CHARS) {
      setNotice('That is too much text for one chat. Remove an attachment, or start a new chat.');
      return;
    }
    store({
      ...chat,
      attachments: [...chat.attachments, { ...item, id: crypto.randomUUID() }],
    });
  }

  /**
   * Attaches a past session.
   *
   * @param sessionId The session.
   * @returns Nothing.
   */
  function attachSession(sessionId: string) {
    loadReview(sessionId)
      .then((review) => {
        if (review) attach({ ...sessionAttachment(review), kind: 'session' });
      })
      .catch(() => setNotice('Paramount AI could not read that session.'));
  }

  /**
   * Opens a chat from the list, or a new one.
   *
   * @param next The chat.
   * @returns Nothing.
   */
  function open(next: StoredChat) {
    cancel.current?.();
    cancel.current = null;
    speaker.stop();
    setSpeaking(false);
    voice.stop();
    setReply(null);
    setNotice(null);
    setChat(next);
    setDraft('');
    setImages([]);
  }

  /**
   * Deletes a chat. If it is the open one, a new chat takes its place.
   *
   * @param id The chat's id.
   * @returns Nothing.
   */
  function remove(id: string) {
    deleteChat(id)
      .then(reload)
      .catch(() => setNotice('The chat could not be deleted.'));
    if (chat.id === id) open(newChat());
  }

  const library = (label: string, items: readonly LibraryItem[]) => (
    <section aria-label={label}>
      <h3 className="mb-1 text-[13px] font-medium text-ui-muted">{label}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-ui-muted">Nothing here yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="w-full truncate py-1 text-left text-[13px] text-ui-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                onClick={() => attach({ name: item.name, kind: item.kind, text: item.text })}
              >
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <PageShell
      title="Ask AI"
      description="A private chat about anything. Chats stay on this computer; each message is sent to Claude to answer it."
      width="lg"
    >
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Chats" className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => open(newChat())}>
            New chat
          </Button>
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto md:max-h-[32rem]">
            {chats.map((item) => (
              <li key={item.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-current={item.id === chat.id ? 'true' : undefined}
                  className={`min-w-0 flex-1 truncate px-2 py-1 text-left text-[13px] focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 ${item.id === chat.id ? 'bg-ui-band font-semibold text-ui-heading' : 'text-ui-text hover:bg-ui-band'}`}
                  onClick={() => open(item)}
                >
                  {item.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${item.title}`}
                  className="px-1.5 py-1 text-[13px] text-ui-muted hover:text-ui-danger focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  onClick={() => remove(item.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label="Chat" className="flex min-w-0 flex-col gap-3">
          {chat.attachments.length > 0 && (
            <ul aria-label="Attached" className="flex flex-wrap gap-1.5">
              {chat.attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex max-w-full items-center gap-1 border border-ui-border px-2 py-0.5 text-[13px] text-ui-text"
                >
                  <span className="truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    className="text-ui-muted hover:text-ui-danger focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                    onClick={() =>
                      store({
                        ...chat,
                        attachments: chat.attachments.filter((item) => item.id !== attachment.id),
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {chat.messages.length === 0 && !reply ? (
            <p className="rounded-card border border-dashed border-ui-border p-5 text-[15px] text-ui-muted">
              Ask anything: an explanation, some maths, a piece of code. Attach a resume, a document
              or a past session to talk about it, or paste a screenshot.
            </p>
          ) : (
            <ol aria-label="Messages" className="flex flex-col gap-2">
              {chat.messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
              {reply && <Message message={reply} streaming />}
            </ol>
          )}
          <div ref={end} />

          {notice && (
            <p
              role="alert"
              className="rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
            >
              {notice}
            </p>
          )}

          {images.length > 0 && (
            <ul aria-label="Screenshots to send" className="flex flex-wrap gap-2">
              {images.map((image) => (
                <li key={image.id} className="relative">
                  {/* From memory (a data URL; never saved). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.dataUrl}
                    alt="Pasted screenshot"
                    className="max-h-24 border border-ui-border"
                  />
                  <button
                    type="button"
                    aria-label="Remove this screenshot"
                    className="absolute right-0 top-0 bg-ui-surface px-1.5 text-[13px] text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                    onClick={() =>
                      setImages((current) => current.filter((item) => item.id !== image.id))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              aria-label="Ask AI"
              rows={3}
              maxLength={MAX_KITE_QUESTION_CHARS}
              className="border border-ui-border bg-ui-input px-3 py-2 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] md:text-[13px]"
              placeholder="Ask anything. Enter sends; Shift+Enter starts a new line. Paste a screenshot here."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={Boolean(reply) || (!draft.trim() && images.length === 0)}
              >
                Send
              </Button>
              <MicButton
                state={voice.state}
                disabled={Boolean(reply)}
                onStart={() => {
                  speaker.stop();
                  setSpeaking(false);
                  voice.start(draft);
                }}
                onStop={voice.stop}
              />
              <Button type="button" variant="secondary" onClick={openAttach}>
                Attach
              </Button>
              {reply && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    cancel.current?.();
                    cancel.current = null;
                    setReply(null);
                  }}
                >
                  Stop
                </Button>
              )}
            </div>
            {voice.error && (
              <p role="alert" className="text-[13px] text-ui-danger">
                {voice.error}
              </p>
            )}
            <VoiceOptions
              canSpeak={canSpeak}
              readAloud={readAloud}
              onReadAloud={(on) => {
                setReadAloudChoice(on);
                setReadAloud(on);
                if (!on) {
                  speaker.stop();
                  setSpeaking(false);
                }
              }}
              handsFree={handsFree}
              onHandsFree={(on) => {
                setHandsFreeChoice(on);
                setHandsFree(on);
                // Turning hands-free off ends the loop: stop listening now.
                if (!on) voice.stop();
              }}
              speaking={speaking}
              onStopSpeaking={stopSpeaking}
            />
          </form>
        </section>
      </div>

      <Dialog open={attachOpen} onClose={() => setAttachOpen(false)} title="Attach to this chat">
        {!choices ? (
          <p className="text-[13px] text-ui-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-ui-muted">
              The chat keeps its own copy, and sends it to Claude with each message.
            </p>
            {library('Resumes', choices.resumes)}
            {library('Documents', choices.documents)}
            <section aria-label="Past sessions">
              <h3 className="mb-1 text-[13px] font-medium text-ui-muted">Past sessions</h3>
              {choices.sessions.length === 0 ? (
                <p className="text-[13px] text-ui-muted">Nothing here yet.</p>
              ) : (
                <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                  {choices.sessions.map((session) => (
                    <li key={session.id}>
                      <button
                        type="button"
                        className="w-full truncate py-1 text-left text-[13px] text-ui-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                        onClick={() => attachSession(session.id)}
                      >
                        {session.company || 'No company'}
                        {session.role ? ` (${session.role})` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Dialog>
    </PageShell>
  );
}
