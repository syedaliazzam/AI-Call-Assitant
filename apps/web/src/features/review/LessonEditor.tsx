/**
 * File: apps/web/src/features/review/LessonEditor.tsx
 * Purpose: Edits one lesson's text and scope (Day 5 Stage 7). The text box holds exactly what
 *          will be sent to Claude: one line, at most MAX_LESSON_CHARS (newlines and repeated
 *          spaces are cleaned as you type), with a character count.
 * Used by: src/features/review/ProposedLessons.tsx, src/features/settings/LearnedLessons.tsx
 * Depends on: @kite/shared (cleanLessonText, MAX_LESSON_CHARS),
 *             src/features/session-setup/labels.ts, src/ui (Button, Input, Select)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.6 (learning loop)
 */
'use client';

import { cleanLessonText, MAX_LESSON_CHARS } from '@kite/shared';
import { useState } from 'react';
import type { LessonScope } from '@/core/storage/types';
import { LESSON_SCOPE_OPTIONS } from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/** Props for LessonEditor. */
export interface LessonEditorProps {
  /** The starting text. */
  text: string;
  /** The starting scope. */
  scope: LessonScope;
  /** The save button's label, for example "Approve" or "Save". */
  saveLabel: string;
  /** Called with the cleaned text and the scope. */
  onSave: (text: string, scope: LessonScope) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

/**
 * The lesson editor.
 *
 * @param props See LessonEditorProps.
 * @returns The text box, the scope choice and the buttons.
 * Rendered by: ProposedLessons.tsx (Edit), LearnedLessons.tsx (Edit)
 */
export function LessonEditor(props: LessonEditorProps) {
  const [text, setText] = useState(cleanLessonText(props.text));
  const [scope, setScope] = useState<LessonScope>(props.scope);
  const cleaned = cleanLessonText(text);
  return (
    <div className="mt-2 space-y-2">
      <Input
        label="Lesson"
        value={text}
        maxLength={MAX_LESSON_CHARS}
        // Typing keeps inner spaces; the saved text is cleaned (one line, trimmed).
        onChange={(event) => setText(event.target.value.replace(/\s+/g, ' '))}
        hint={`${cleaned.length}/${MAX_LESSON_CHARS} characters. Paramount AI sends exactly this text to Claude.`}
      />
      <Select label="Applies to" options={LESSON_SCOPE_OPTIONS} value={scope} onChange={setScope} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => props.onSave(cleaned, scope)} disabled={cleaned === ''}>
          {props.saveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
