/**
 * File: apps/web/src/features/admin/ai-settings/TryPanel.tsx
 * Purpose: Admin → AI settings' "Try it" for one block (ADR-0083): a sample question (or, for the
 *          notes, a sample call), an optional session from this device for context, and the reply made
 *          with the DRAFT instructions, before saving. Each try is one normal request against the
 *          daily limit.
 * Used by: src/features/admin/ai-settings/InstructionsEditor.tsx
 * Depends on: React, src/core/admin/aiTry.ts, src/features/answers/AnswerBody.tsx, src/ui (Button,
 *             Select, Textarea), ./blocks.ts, ./blocks.ts (CARD)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { AiInstructionBlock, AiTryResponse, CallNotes } from '@kite/shared';
import { listTrySessions, runAiTry, type TrySessionOption } from '@/core/admin/aiTry';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { BLOCK_COPY, CARD } from './blocks';

/** Props for TryPanel. */
export interface TryPanelProps {
  /** Which block. */
  block: AiInstructionBlock;
  /** The draft in the editor (not saved). */
  draft: string;
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
export function TryPanel({ block, draft }: TryPanelProps) {
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
    const outcome = await runAiTry({ block, draft, sample, sessionId });
    setRunning(false);
    if (outcome.ok) setReply(outcome.reply);
    else setError(outcome.message);
  }

  return (
    <section aria-label={`Try ${copy.label}`} className={CARD}>
      <div className="flex items-center gap-2">
        <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} className="text-ui-muted" />
        <h2 className="text-[18px] font-semibold text-ui-heading">Try it</h2>
      </div>
      <p className="mt-1 max-w-prose text-[13px] text-ui-muted">
        See a reply made with the draft above, before you save. Each try is one request and counts
        towards your daily limit.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_16rem]">
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
        <Button onClick={() => void run()} disabled={running || sample.trim() === ''}>
          {running ? 'Trying…' : 'Try with draft'}
        </Button>
        {draft.trim() === '' && (
          <span className="text-[13px] text-ui-muted">
            The draft is empty: this shows today&rsquo;s behaviour.
          </span>
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
