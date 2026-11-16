/**
 * File: apps/web/src/features/admin/ai-settings/TryPanel.tsx
 * Purpose: Admin → AI settings' "Try it" for one tab (ADR-0083, ADR-0089): a sample question (or, for the
 *          notes, a sample call), an optional session from this device for context, and the reply made
 *          with the DRAFT global prompt, before saving. A live answer is shown in the same answer card
 *          users see during a call (question, answer line, bullets, tags). Each try is one normal request
 *          against the daily limit, and a successful try lets that exact draft be saved.
 * Used by: src/features/admin/ai-settings/PromptWorkspace.tsx
 * Depends on: React, src/core/admin/aiTry.ts, src/features/answers (AnswerBody, AnswerTags), src/ui
 *             (Button, Select, Textarea), ./blocks.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import type { AiInstructionBlock, AiTryResponse, CallNotes } from '@kite/shared';
import { listTrySessions, runAiTry, type TrySessionOption } from '@/core/admin/aiTry';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { AnswerTags } from '@/features/answers/AnswerTags';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { BLOCK_COPY } from './blocks';

/** Props for TryPanel. */
export interface TryPanelProps {
  /** Which tab. */
  block: AiInstructionBlock;
  /** The draft global prompt to try. */
  prompt: string;
  /** Called after a successful try with the save token and the exact prompt that was sent. */
  onTried: (promptToken: string, sent: string) => void;
}

/** The session list's "no session" choice. */
const NO_SESSION = '';

/**
 * A reply's notes, as the notes page lists them.
 *
 * @param props.notes The notes.
 * @returns The sections that have something.
 * Rendered by: TryPanel
 */
function NotesView({ notes }: { /** The notes. */ notes: CallNotes }) {
  const sections: { title: string; items: string[] }[] = [
    { title: 'Summary', items: notes.summary },
    { title: 'Questions asked', items: notes.questions.map((question) => question.question) },
    {
      title: 'Next steps',
      items: notes.nextSteps.map((step) =>
        step.owner ? `${step.step} (${step.owner})` : step.step,
      ),
    },
    { title: 'Unclear', items: notes.unclear.map((part) => part.reason) },
  ];
  const shown = sections.filter((section) => section.items.length > 0);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-ui-border bg-ui-surface p-4 shadow-card">
      {shown.length === 0 && <p className="text-[14px] text-ui-muted">The notes are empty.</p>}
      {shown.map((section) => (
        <div key={section.title}>
          <h4 className="text-[13px] font-semibold text-ui-heading">{section.title}</h4>
          <ul className="mt-1 list-disc pl-5 text-[14px] leading-relaxed text-ui-text">
            {section.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Props for AnswerCardPreview. */
export interface AnswerCardPreviewProps {
  /** The reply. */
  reply: Extract<AiTryResponse, { kind: 'answer' }>;
  /** The sample question (shown when the reply has no cleaned question). */
  sample: string;
  /** The session's type, for the source tag's words. */
  sessionType?: string;
}

/**
 * The answer card as a user sees it during a call: the question, the answer line and the rest, then the
 * quiet footer with the tags.
 *
 * @param props See AnswerCardPreviewProps.
 * @returns The card.
 * Rendered by: TryPanel
 */
export function AnswerCardPreview({ reply, sample, sessionType }: AnswerCardPreviewProps) {
  return (
    <article
      aria-label="Answer"
      className="rounded-card border border-ui-accent bg-ui-surface p-4 shadow-card"
      data-testid="try-reply"
    >
      <p aria-label="Question" className="text-[15px] font-semibold leading-snug text-ui-text">
        {reply.question ?? sample}
      </p>
      <div className="mt-2">
        {reply.text ? (
          <AnswerBody
            text={reply.text}
            finished
            size="panel"
            answerLabel
            headlineLabel="Answer line"
            {...(reply.meta?.target ? { target: reply.meta.target } : {})}
          />
        ) : (
          <p className="text-[15px] text-ui-muted">
            No answer: the AI read this as needing none (garbled words, or talk about the call
            itself).
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ui-muted">
        <AnswerTags
          compact
          meta={reply.meta ?? undefined}
          {...(sessionType ? { sessionType } : {})}
        />
        {reply.meta && <span aria-hidden="true">·</span>}
        <span>Try it</span>
      </div>
    </article>
  );
}

/**
 * "Try it" for one tab.
 *
 * @param props See TryPanelProps.
 * @returns The panel.
 * Rendered by: PromptWorkspace.tsx
 */
export function TryPanel({ block, prompt, onTried }: TryPanelProps) {
  const copy = BLOCK_COPY[block];
  const [sample, setSample] = useState('');
  const [sessions, setSessions] = useState<TrySessionOption[]>([]);
  const [sessionId, setSessionId] = useState<string>(NO_SESSION);
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<{ response: AiTryResponse; sample: string } | null>(null);
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

  /** Runs the try with the draft as it is now. */
  async function run() {
    setRunning(true);
    setError(null);
    setReply(null);
    const sent = prompt;
    const asked = sample.trim();
    const outcome = await runAiTry({ block, prompt: sent, sample: asked, sessionId });
    setRunning(false);
    if (outcome.ok) {
      setReply({ response: outcome.reply, sample: asked });
      onTried(outcome.reply.promptToken, sent);
    } else setError(outcome.message);
  }

  return (
    <section aria-label={`Try ${copy.label}`} className="flex flex-col gap-4">
      <p className="text-[13px] text-ui-muted">
        One real request with this draft, exactly as users get it (counts towards your daily limit).
        A successful try lets you save this exact draft.
      </p>
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <Textarea
          label={copy.sampleLabel}
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          placeholder={copy.samplePlaceholder}
          maxLength={4_000}
          rows={block === 'notes' ? 5 : 2}
        />
        <Select<string>
          label="Session for context (optional)"
          options={[
            { value: NO_SESSION, label: 'No session' },
            ...sessions.map((session) => ({ value: session.id, label: session.label })),
          ]}
          value={sessionId}
          onChange={setSessionId}
          hint="Its details, preferences and documents, from this device."
          searchable={sessions.length > 8}
        />
      </div>
      <div>
        <Button onClick={() => void run()} disabled={running || sample.trim() === ''}>
          <Play aria-hidden="true" size={14} className="mr-1.5" />
          {running ? 'Trying…' : 'Run Try it'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-helper text-ui-danger">
          {error}
        </p>
      )}
      {reply && (
        <div aria-live="polite" className="max-w-[40rem]">
          {reply.response.kind === 'notes' ? (
            <NotesView notes={reply.response.notes} />
          ) : (
            <AnswerCardPreview reply={reply.response} sample={reply.sample} />
          )}
        </div>
      )}
    </section>
  );
}
