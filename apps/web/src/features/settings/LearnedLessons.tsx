/**
 * File: apps/web/src/features/settings/LearnedLessons.tsx
 * Purpose: "What Kite has learned" in Settings (Day 5 Stage 7): every approved lesson, exactly
 *          as it is sent to Claude, with its scope; Edit (text and scope), Delete, and "Clear all
 *          lessons" (asks first in an in-app dialog). Rejected proposals are counted, and cleared
 *          with the rest.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/lessons/decide.ts, src/core/storage/lessons.ts (listLessons),
 *             src/features/review/LessonEditor.tsx, src/features/session-setup/labels.ts,
 *             src/ui (Button, Dialog)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Settings), §7.6
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearLessons, editLesson, removeLesson } from '@/core/lessons/decide';
import { listLessons } from '@/core/storage/lessons';
import type { StoredLesson } from '@/core/storage/types';
import { LessonEditor } from '@/features/review/LessonEditor';
import { lessonScopeLabel } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

/** Date format for "approved on". */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The learned lessons section.
 *
 * @returns The list and its actions.
 * Rendered by: Settings.tsx (remounted after "Delete all local data")
 */
export function LearnedLessons() {
  // null while loading.
  const [lessons, setLessons] = useState<StoredLesson[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Reads the lessons again after a change. */
  const reload = useCallback(async () => {
    setLessons(await listLessons().catch(() => []));
  }, []);

  useEffect(() => {
    let cancelled = false;
    listLessons()
      .catch(() => [])
      .then((rows) => {
        if (!cancelled) setLessons(rows);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Runs one change, then reloads.
   *
   * @param action The storage action.
   */
  async function run(action: () => Promise<unknown>) {
    setFailed(false);
    try {
      await action();
      setEditingId(null);
      setConfirming(false);
    } catch {
      setFailed(true);
    }
    await reload();
  }

  if (lessons === null) return <p className="text-[13px] text-ui-muted">Loading…</p>;
  const approved = lessons
    .filter((lesson) => lesson.status === 'approved')
    .sort((a, b) => (a.approvedAt ?? 0) - (b.approvedAt ?? 0));
  const rejected = lessons.length - approved.length;

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-ui-muted">
        Lessons you approved after a call. Paramount AI sends them, exactly as shown, with every
        answer in the calls they apply to, as your preferences: they adjust the style and content of
        answers and never override Paramount AI&apos;s rules. At most the 20 newest are sent.
      </p>
      {approved.length === 0 ? (
        <p className="text-ui-muted">
          No lessons yet. Approve one from the proposed lessons on a session&apos;s review page.
        </p>
      ) : (
        <ul aria-label="Learned lessons" className="space-y-2">
          {approved.map((lesson) => (
            <li key={lesson.id} aria-label="Learned lesson" className="border border-ui-border p-3">
              {editingId === lesson.id ? (
                <LessonEditor
                  text={lesson.text}
                  scope={lesson.scope}
                  saveLabel="Save"
                  onSave={(text, scope) => void run(() => editLesson(lesson.id, text, scope))}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <p className="text-ui-heading">{lesson.text}</p>
                  <p className="mt-1 text-[13px] text-ui-muted">
                    {lessonScopeLabel(lesson.scope)} · approved{' '}
                    {DATE_FORMAT.format(lesson.approvedAt ?? lesson.decidedAt)}
                    {lesson.evidence && ` · based on: ${lesson.evidence}`}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(lesson.id)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void run(() => removeLesson(lesson.id))}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {rejected > 0 && (
        <p className="text-[13px] text-ui-muted">
          {rejected} rejected{' '}
          {rejected === 1
            ? 'proposal is remembered, so it is not offered again.'
            : 'proposals are remembered, so they are not offered again.'}
        </p>
      )}
      {lessons.length > 0 && (
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
          Clear all lessons
        </Button>
      )}
      {failed && (
        <p role="alert" className="text-ui-danger">
          That could not be saved. Try again.
        </p>
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear all lessons?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void run(() => clearLessons())}>
              Clear all lessons
            </Button>
          </>
        }
      >
        <p>
          Every approved lesson and every rejected proposal will be deleted. Paramount AI stops
          sending lessons with answers from the next session you open. This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
