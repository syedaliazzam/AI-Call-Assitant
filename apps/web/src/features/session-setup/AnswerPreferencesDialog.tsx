/**
 * File: apps/web/src/features/session-setup/AnswerPreferencesDialog.tsx
 * Purpose: The Answer preferences window: format, length and tone, with an Answer preview per
 *          question type. A preview is written only when asked for (one Haiku request) and kept
 *          for that combination of settings. "Set as default" saves the choice for new sessions.
 * Used by: src/features/session-setup/PreferencesStep.tsx
 * Depends on: src/core/answer/preview.ts, src/core/answer/format.ts (splitAnswer),
 *             src/core/storage (settings, types), ./labels.ts, src/ui (Button, Dialog)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F3), §7.2; ADR-0029
 */
'use client';

import { useId, useState } from 'react';
import type { PreviewQuestionType } from '@kite/shared';
import { splitAnswer } from '@/core/answer/format';
import { keptPreview, loadPreview } from '@/core/answer/preview';
import { getSessionDefaults, saveSessionDefaults } from '@/core/storage/settings';
import { answerLanguageName, type AnswerStyle } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { FORMAT_OPTIONS, LENGTH_OPTIONS, TONE_OPTIONS } from './labels';

/** The preview's question types, with their names on screen. */
const QUESTION_OPTIONS: readonly { value: PreviewQuestionType; label: string }[] = [
  { value: 'behavioural', label: 'Behavioural' },
  { value: 'technical', label: 'Technical' },
  { value: 'general', label: 'General' },
];

/**
 * One row of choices, one of which is on.
 *
 * @param props.label    The group's name.
 * @param props.options  The choices.
 * @param props.value    The current choice.
 * @param props.onChange Takes a new choice.
 * @returns The group.
 * Rendered by: AnswerPreferencesDialog
 */
function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** The group's name. */
  label: string;
  /** The choices. */
  options: readonly { value: T; label: string }[];
  /** The current choice. */
  value: T;
  /** Takes a new choice. */
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <span
        id={id}
        className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted"
      >
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            onClick={() => onChange(option.value)}
            className={[
              'border px-3 py-1.5 text-[14px] focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11',
              option.value === value
                ? 'border-ui-primary bg-ui-primary font-semibold text-ui-primary-text'
                : 'border-ui-border bg-ui-surface text-ui-text hover:bg-ui-band',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Props for AnswerPreferencesDialog. */
export interface AnswerPreferencesDialogProps {
  /** Whether it is open. */
  open: boolean;
  /** Closes it without changing anything. */
  onClose: () => void;
  /** The current style. */
  style: AnswerStyle;
  /** The answer language's code. */
  language: string;
  /** Takes the chosen style. */
  onApply: (style: AnswerStyle) => void;
}

/**
 * The Answer preferences window. The form is mounted only while open, so it always starts from
 * the session's current style.
 *
 * @param props See AnswerPreferencesDialogProps.
 * @returns The dialog.
 * Rendered by: PreferencesStep.tsx
 */
export function AnswerPreferencesDialog(props: AnswerPreferencesDialogProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Answer preferences" size="lg">
      {props.open && <PreferencesForm {...props} />}
    </Dialog>
  );
}

/**
 * The window's contents.
 *
 * @param props See AnswerPreferencesDialogProps.
 * @returns The choices, the preview and the actions.
 * Rendered by: AnswerPreferencesDialog
 */
function PreferencesForm({ style, language, onApply, onClose }: AnswerPreferencesDialogProps) {
  const [draft, setDraft] = useState(style);
  const [question, setQuestion] = useState<PreviewQuestionType>('behavioural');
  const [loading, setLoading] = useState(false);
  // The settings the last failure or default was for: changing them clears the message.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [savedStyle, setSavedStyle] = useState<string | null>(null);
  const languageName = answerLanguageName(language);
  const request = {
    style: draft,
    question,
    ...(languageName ? { language: languageName } : {}),
  };
  const key = JSON.stringify(request);

  // A preview kept for these settings shows at once, and costs nothing. Reading it here is cheap:
  // this form exists only in the browser, while the window is open.
  const text = keptPreview(request);
  const failed = failedKey === key;
  const savedDefault = savedStyle === JSON.stringify(draft);

  /** Writes the preview for the current settings. */
  async function show() {
    setLoading(true);
    setFailedKey(null);
    const outcome = await loadPreview(request);
    // On success the text is kept, and the render this causes reads it.
    setLoading(false);
    setFailedKey(outcome.ok ? null : key);
  }

  /** Saves the current settings as the default for new sessions. */
  async function setAsDefault() {
    const defaults = await getSessionDefaults();
    await saveSessionDefaults({ ...defaults, style: draft });
    setSavedStyle(JSON.stringify(draft));
  }

  const parts = text ? splitAnswer(text) : null;
  return (
    <div className="flex flex-col gap-4 text-ui-text">
      <Choices
        label="Format"
        options={FORMAT_OPTIONS}
        value={draft.format}
        onChange={(format) => setDraft({ ...draft, format })}
      />
      <Choices
        label="Length"
        options={LENGTH_OPTIONS}
        value={draft.length}
        onChange={(length) => setDraft({ ...draft, length })}
      />
      <Choices
        label="Tone"
        options={TONE_OPTIONS}
        value={draft.tone}
        onChange={(tone) => setDraft({ ...draft, tone })}
      />

      <section aria-label="Answer preview" className="flex flex-col gap-2 bg-ui-band p-4">
        <Choices
          label="Answer preview"
          options={QUESTION_OPTIONS}
          value={question}
          onChange={setQuestion}
        />
        {parts ? (
          <div aria-live="polite" className="text-[15px]">
            <p className="font-semibold text-ui-heading">{parts.headline}</p>
            {parts.bullets.length > 0 && (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {parts.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
            {parts.tip && <p className="mt-2">{parts.tip}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => void show()} disabled={loading}>
              {loading ? 'Writing…' : 'Show preview'}
            </Button>
            <span className="text-[13px] text-ui-muted">
              {failed
                ? 'Kite could not write a preview just now. Try again.'
                : 'An invented example, written with these settings.'}
            </span>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void setAsDefault()}>
            Set as default
          </Button>
          {savedDefault && (
            <span role="status" className="text-[13px] text-ui-success">
              New sessions will start with these.
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
