/**
 * File: apps/web/src/features/admin/ai-settings/TryPanel.tsx
 * Purpose: Admin → AI settings' "Try it" for one block (ADR-0083): a sample question (or, for the
 *          notes, a sample call), an optional session from this device for context, and the reply made
 *          with the DRAFT instructions (and, ADR-0086, a draft full prompt), before saving. Each try is
 *          one normal request against the daily limit. Shown inside the editor's card.
 * Used by: src/features/admin/ai-settings/InstructionsEditor.tsx, PromptEditor.tsx
 * Depends on: React, src/core/admin/aiTry.ts, src/features/answers/AnswerBody.tsx, src/ui (Button,
 *             Select, Textarea), ./blocks.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0086-full-system-prompt-editing.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { AiInstructionBlock, AiTryResponse, CallNotes, CustomPrompt } from '@kite/shared';
import { listTrySessions, runAiTry, type TrySessionOption } from '@/core/admin/aiTry';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { BLOCK_COPY } from './blocks';

/** Props for TryPanel. */
export interface TryPanelProps {
  /** Which block. */
  block: AiInstructionBlock;
  /** The instructions to try (simple mode: the draft; advanced mode: the instructions in force). */
  draft: string;
  /**
   * ADR-0086: the full prompt to try (advanced mode's draft, or a custom prompt in force), or null for
   * the built-in prompt.
   */
  prompt?: CustomPrompt | null;
  /** When set, the try cannot run, and this says why (for example a prompt missing a rule). */
  blockedReason?: string | null;
  /**
   * Called after a successful try, with the token that lets a tried prompt be saved and the prompt
   * that was actually sent (the draft may have changed while the try ran).
   */
  onTried?: (promptToken: string | undefined, sent: CustomPrompt | null) => void;
  /** The button's words (default "Try with draft"). */
  buttonLabel?: string;
}

/** The session list's "no session" choice. */
const NO_SESSION = '';

/**
 * A reply's notes, as lists.
 *
 * @param props.notes The notes.
 * @returns The sections that have something.
 * Rendered by: TryPanel
 */
function NotesView({ notes }: { /** The notes. */ notes: CallNotes }) {
  const sections: { title: string; items: string[] }[] = [
    { title: 'Summary', items: notes.summary },
    {
      title: 'Questions asked',
      items: notes.questions.map((question) => question.question),
    },
    {
      title: 'Next steps',
      items: notes.nextSteps.map((step) =>
        step.owner ? `${step.step} (${step.owner})` : step.step,
      ),
    },
    { title: 'Unclear', items: notes.unclear.map((part) => part.reason) },
  ];
  return (
    <div className="flex flex-col gap-3">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <div key={section.title}>
            <h4 className="text-[13px] font-semibold text-ui-heading">{section.title}</h4>
            <ul className="mt-1 list-disc pl-5 text-[14px] text-ui-text">
              {section.items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

/**
 * The reply of a try.
 *
 * @param props.reply The reply.
 * @returns The answer or the notes.
 * Rendered by: TryPanel
 */
function ReplyView({ reply }: { /** The reply. */ reply: AiTryResponse }) {
  if (reply.kind === 'notes') return <NotesView notes={reply.notes} />;
  return (
    <div className="flex flex-col gap-2">
      {reply.meta && (
        <p className="text-[12px] text-ui-muted">
          Question type: <span className="text-ui-text">{reply.meta.type}</span> · for{' '}
          <span className="text-ui-text">
            {reply.meta.target === 'kite' ? 'the user' : 'the call'}
          </span>{' '}
          · source <span className="text-ui-text">{reply.meta.source}</span>
        </p>
      )}
      {reply.text ? (
        <AnswerBody
          text={reply.text}
          finished
          size="chat"
          {...(reply.meta?.target ? { target: reply.meta.target } : {})}
        />
      ) : (
        <p className="text-[14px] text-ui-muted">
          No answer: the AI read this as needing none (for example garbled words or talk about the
          call itself).
        </p>
      )}
    </div>
  );
}

/**
 * "Try it" for one block.
 *
 * @param props See TryPanelProps.
 * @returns The card.
 * Rendered by: InstructionsEditor.tsx
 */
export function TryPanel({
  block,
  draft,
  prompt = null,
  blockedReason = null,
  onTried,
  buttonLabel = 'Try with draft',
}: TryPanelProps) {
  const copy = BLOCK_COPY[block];
  const [sample, setSample] = useState('');
  const [sessions, setSessions] = useState<TrySessionOption[]>([]);
  const [sessionId, setSessionId] = useState<string>(NO_SESSION);
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<AiTryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // This device's sessions (they are stored here, never on the server).
  useEffect(() => {
    let live = true;
    void listTrySessions().then((options) => {
      if (live) setSessions(options);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Runs the try with the draft. */
  async function run() {
    setRunning(true);
    setError(null);
    setReply(null);
    // The prompt as it is now: what the token, if any, will prove was tried.
    const sent = prompt;
    const outcome = await runAiTry({
      block,
      draft,
      sample,
      sessionId,
      ...(sent ? { prompt: sent } : {}),
    });
    setRunning(false);
    if (outcome.ok) {
      setReply(outcome.reply);
      onTried?.(outcome.reply.promptToken, sent);
    } else setError(outcome.message);
  }

  return (
    <section
      aria-label={`Try ${copy.label}`}
      className="rounded-control border border-ui-border bg-ui-subtle/40 p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ui-heading">
          <FlaskConical aria-hidden="true" size={15} strokeWidth={1.75} className="text-ui-muted" />
          Try it
        </span>
        <span className="text-[13px] text-ui-muted">
          One real request with this draft, before you save (counts towards your daily limit).
        </span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_16rem]">
        <Textarea
          label={copy.sampleLabel}
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          placeholder={copy.samplePlaceholder}
          maxLength={4_000}
          rows={block === 'notes' ? 5 : 2}
        />
        <Select<string>
          label="Session for context"
          options={[
            { value: NO_SESSION, label: 'No session' },
            ...sessions.map((session) => ({ value: session.id, label: session.label })),
          ]}
          value={sessionId}
          onChange={setSessionId}
          hint="Its details and documents, from this device."
          searchable={sessions.length > 8}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => void run()}
          disabled={running || sample.trim() === '' || blockedReason !== null}
        >
          {running ? 'Trying…' : buttonLabel}
        </Button>
        {blockedReason !== null && (
          <span className="text-[13px] text-ui-muted">{blockedReason}</span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-helper text-ui-danger">
          {error}
        </p>
      )}
      {reply && (
        <div
          aria-live="polite"
          className="mt-4 rounded-control border border-ui-border bg-ui-subtle p-4"
          data-testid="try-reply"
        >
          <ReplyView reply={reply} />
        </div>
      )}
    </section>
  );
}
