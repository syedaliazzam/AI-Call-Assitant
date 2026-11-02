/**
 * File: apps/web/src/features/prepare/QuestionBank.tsx
 * Purpose: The Question Bank page: for a chosen session, the questions most likely to come up, by
 *          type, each with a suggested answer in the session's format, written from its job
 *          description and resume. Saved on this device, so it can be reviewed later at no cost;
 *          writing it again replaces it.
 * Used by: app/(app)/question-bank/page.tsx
 * Depends on: src/core/prepare/client.ts, src/core/answer/warm.ts (toSessionContext),
 *             src/core/answer/format.ts (splitAnswer), src/core/storage (sessions, documents,
 *             questionBanks), src/ui (Button, Eyebrow, LinkButton, PageShell, Select)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0029
 */
'use client';

import { useEffect, useState } from 'react';
import type { BankQuestionType } from '@kite/shared';
import { splitAnswer } from '@/core/answer/format';
import { toSessionContext } from '@/core/answer/warm';
import { prepare } from '@/core/prepare/client';
import { listDocuments } from '@/core/storage/documents';
import { getQuestionBank, saveQuestionBank } from '@/core/storage/questionBanks';
import { listSessions } from '@/core/storage/sessions';
import type { Session, StoredQuestionBank } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';
import { Select } from '@/ui/Select';

/** The heading for each kind of question. */
const GROUP_LABELS: Record<BankQuestionType, string> = {
  behavioural: 'Behavioural',
  technical: 'Technical',
  role: 'About this role',
  company: 'About this company',
};

/**
 * The words for a session in the picker.
 *
 * @param session The session.
 * @returns For example "Data Analyst at Lantern Freight".
 * Called from: QuestionBank, MockInterview
 */
export function sessionChoiceLabel(session: Session): string {
  return `${session.role} at ${session.company}`;
}

/**
 * The Question Bank page.
 *
 * @returns The page.
 * Rendered by: app/(app)/question-bank/page.tsx
 */
export function QuestionBank() {
  // null while loading.
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [chosenId, setChosenId] = useState('');
  const [bank, setBank] = useState<StoredQuestionBank | null>(null);
  const [writing, setWriting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((rows) => {
        if (cancelled) return;
        // Questions are for a job: regular calls do not belong here.
        const usable = rows.filter((session) => session.type !== 'regular');
        setSessions(usable);
        setChosenId(usable[0]?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A saved bank shows at once, and costs nothing.
  useEffect(() => {
    let cancelled = false;
    (chosenId ? getQuestionBank(chosenId) : Promise.resolve(null))
      .catch(() => null)
      .then((saved) => {
        if (!cancelled) setBank(saved);
      });
    return () => {
      cancelled = true;
    };
  }, [chosenId]);

  /** Writes the bank for the chosen session and saves it. */
  async function write() {
    const session = sessions?.find((candidate) => candidate.id === chosenId);
    if (!session) return;
    setWriting(true);
    setFailure(null);
    const documents = await listDocuments(session.id);
    const outcome = await prepare({
      kind: 'question-bank',
      session: toSessionContext(session, documents),
    });
    setWriting(false);
    if (!outcome.ok) {
      setFailure(outcome.message);
      return;
    }
    const saved: StoredQuestionBank = {
      sessionId: session.id,
      groups: outcome.data.groups,
      createdAt: Date.now(),
    };
    setBank(saved);
    // Shown either way; if saving fails, it is written again next time.
    await saveQuestionBank(saved).catch(() => undefined);
  }

  return (
    <PageShell
      eyebrow="Prepare"
      title="Question Bank"
      description="The questions most likely to come up, with suggested answers from your job description and resume. Saved on this computer."
      width="lg"
    >
      {sessions && sessions.length === 0 && (
        <section className="border border-ui-border bg-ui-surface px-6 py-10 text-center">
          <p className="text-[15px] text-ui-muted">
            Create an Interview or Mock session first: its job description and resume are what the
            questions come from.
          </p>
          <LinkButton href="/sessions/new?type=interview" variant="primary" className="mt-4">
            Create session
          </LinkButton>
        </section>
      )}
      {sessions && sessions.length > 0 && (
        <section className="flex flex-wrap items-end gap-3 border border-ui-border bg-ui-surface p-5">
          <div className="min-w-0 flex-1 basis-64">
            <Select
              label="Session"
              options={sessions.map((session) => ({
                value: session.id,
                label: sessionChoiceLabel(session),
              }))}
              value={chosenId}
              onChange={setChosenId}
            />
          </div>
          <Button
            variant={bank ? 'secondary' : 'primary'}
            onClick={() => void write()}
            disabled={writing}
          >
            {writing ? 'Writing…' : bank ? 'Write again' : 'Write questions'}
          </Button>
        </section>
      )}
      {writing && (
        <p role="status" className="text-sm text-ui-muted">
          Writing the questions and answers. This can take up to a minute.
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-ui-danger">
          {failure}
        </p>
      )}
      {bank?.groups.map((group) => (
        <section
          key={group.type}
          aria-label={GROUP_LABELS[group.type]}
          className="border border-ui-border bg-ui-surface p-5"
        >
          <h2 className="text-[20px] text-ui-subheading">{GROUP_LABELS[group.type]}</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {group.questions.map((item) => {
              const parts = splitAnswer(item.answer);
              return (
                <li key={item.question} className="border-t border-ui-border pt-3">
                  <details>
                    <summary className="cursor-pointer text-[15px] font-semibold text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11">
                      {item.question}
                    </summary>
                    <div className="mt-2 text-[15px] text-ui-text">
                      <p className="font-medium">{parts.headline}</p>
                      {parts.bullets.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {parts.bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </PageShell>
  );
}
