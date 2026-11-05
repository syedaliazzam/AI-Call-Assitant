/**
 * File: apps/web/src/features/review/ProposedLessons.tsx
 * Purpose: The proposed lessons on the review page (Day 5 Stage 7), each with Approve, Edit and
 *          Reject and a scope choice. Nothing is learned without approval. A proposal the user
 *          already decided on (the same or a reworded lesson from this session,
 *          core/lessons/match.ts) shows that decision with Undo, so regenerating the notes never
 *          asks twice or makes a duplicate.
 * Used by: src/features/review/ReviewSections.tsx (NotesSection)
 * Depends on: @kite/shared (ProposedLesson), src/core/lessons (decide.ts, match.ts),
 *             src/features/review/LessonEditor.tsx, src/features/session-setup/labels.ts,
 *             src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.6 (learning loop)
 */
'use client';

import { cleanLessonText, type ProposedLesson } from '@kite/shared';
import { useState } from 'react';
import { decideLesson, removeLesson } from '@/core/lessons/decide';
import { findDecision } from '@/core/lessons/match';
import type { LessonScope, SessionType, StoredLesson } from '@/core/storage/types';
import { lessonScopeLabel } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { LessonEditor } from './LessonEditor';

/** Props for ProposedLessons. */
export interface ProposedLessonsProps {
  /** The session whose notes proposed them. */
  sessionId: string;
  /** Its type (the default scope). */
  sessionType: SessionType;
  /** The proposals from the notes. */
  proposals: readonly ProposedLesson[];
  /** The decisions already stored for this session. */
  decisions: readonly StoredLesson[];
  /** Called after a decision was saved or undone (the page reloads its data). */
  onChanged: () => void;
}

/**
 * The proposed lessons.
 *
 * @param props See ProposedLessonsProps.
 * @returns The list.
 * Rendered by: NotesSection in ReviewSections.tsx
 */
export function ProposedLessons(props: ProposedLessonsProps) {
  return (
    <div>
      <h3 className="font-semibold text-ui-heading">Proposed lessons</h3>
      <p className="text-[13px] text-ui-muted">
        Suggestions only: Paramount AI learns nothing until you approve a lesson. Approved lessons
        are sent with later answers, exactly as shown, as your preferences.
      </p>
      <ul aria-label="Proposed lessons" className="mt-1 space-y-2">
        {props.proposals.map((proposal, i) => (
          <ProposedLessonItem
            key={i}
            {...props}
            proposal={proposal}
            decision={findDecision(proposal.text, props.sessionId, props.decisions)}
          />
        ))}
      </ul>
    </div>
  );
}

/** Props for one proposal. */
interface ProposedLessonItemProps extends ProposedLessonsProps {
  /** The proposal. */
  proposal: ProposedLesson;
  /** The user's decision on it, or null. */
  decision: StoredLesson | null;
}

/**
 * One proposal: its decision with Undo, or Approve / Edit / Reject.
 *
 * @param props See ProposedLessonItemProps.
 * @returns The list item.
 * Rendered by: ProposedLessons
 */
function ProposedLessonItem(props: ProposedLessonItemProps) {
  const { proposal, decision } = props;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Runs one action, then asks the page to reload.
   *
   * @param action The storage action.
   */
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      setEditing(false);
      props.onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Saves a decision.
   *
   * @param status Approve or reject.
   * @param text   The text to keep.
   * @param scope  Which sessions it applies to.
   */
  function decide(status: 'approved' | 'rejected', text: string, scope: LessonScope) {
    void run(() => decideLesson({ sessionId: props.sessionId, proposal, status, text, scope }));
  }

  return (
    <li aria-label="Proposed lesson" className="rounded-control bg-ui-band px-3 py-2">
      <p>{decision ? decision.text : cleanLessonText(proposal.text)}</p>
      <p className="text-[13px] text-ui-muted">Based on: {proposal.evidence}</p>
      {decision ? (
        <div className="mt-1 flex items-center gap-2 text-[13px]">
          <span
            aria-label="Decision"
            className={
              decision.status === 'approved'
                ? 'rounded-control bg-ui-success-bg px-2 py-0.5 font-semibold text-ui-success'
                : 'rounded-control bg-ui-band px-2 py-0.5 font-semibold text-ui-text'
            }
          >
            {decision.status === 'approved'
              ? `Approved · ${lessonScopeLabel(decision.scope)}`
              : 'Rejected'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => removeLesson(decision.id))}
          >
            Undo
          </Button>
        </div>
      ) : editing ? (
        <LessonEditor
          text={proposal.text}
          scope={props.sessionType}
          saveLabel="Approve"
          onSave={(text, scope) => decide('approved', text, scope)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="mt-1 flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => decide('approved', proposal.text, props.sessionType)}
          >
            Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => decide('rejected', proposal.text, props.sessionType)}
          >
            Reject
          </Button>
        </div>
      )}
      {!decision && !editing && (
        <p className="mt-1 text-[13px] text-ui-muted">
          Approve applies it to {lessonScopeLabel(props.sessionType).toLowerCase()}; use Edit to
          change the text or apply it to all calls.
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-1 text-[13px] text-ui-danger">
          That could not be saved. Try again.
        </p>
      )}
    </li>
  );
}
