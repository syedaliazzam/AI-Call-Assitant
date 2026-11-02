/**
 * File: apps/web/src/features/session-setup/PreferencesStep.tsx
 * Purpose: Step 2 of the Create/Edit session wizard: Answer preferences (a window with a preview),
 *          answer language, AI instructions (their own window), model, key terms (names and terms
 *          to listen for, which become speech-to-text hotwords), and the save-transcript and
 *          auto-answer switches.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: src/ui (Button, Dialog, Select, Textarea, Toggle), ./draft.ts, ./labels.ts,
 *             ./AnswerPreferencesDialog.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F3), §5; ADR-0029
 */
'use client';

import { useState, type ReactNode } from 'react';
import { ANSWER_LANGUAGES } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { Toggle } from '@/ui/Toggle';
import { AnswerPreferencesDialog } from './AnswerPreferencesDialog';
import type { SessionDraft } from './draft';
import { MODEL_OPTIONS, styleSummary } from './labels';

/** Props for PreferencesStep. */
export interface PreferencesStepProps {
  /** The wizard's draft. */
  draft: SessionDraft;
  /** Applies changes to the draft. */
  onChange: (changes: Partial<SessionDraft>) => void;
}

/**
 * A row that sums up a setting, with a button that opens its window.
 *
 * @param props.title  What it is.
 * @param props.action The button's words.
 * @param props.onOpen Opens the window.
 * @param props.children The summary.
 * @returns The row.
 * Rendered by: PreferencesStep
 */
function SummaryRow({
  title,
  action,
  onOpen,
  children,
}: {
  /** What it is. */
  title: string;
  /** The button's words. */
  action: string;
  /** Opens the window. */
  onOpen: () => void;
  /** The summary. */
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-ui-border px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted">
          {title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[15px] text-ui-text">{children}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onOpen} aria-label={`${action}: ${title}`}>
        {action}
      </Button>
    </div>
  );
}

/**
 * Step 2: preferences.
 *
 * @param props See PreferencesStepProps.
 * @returns The step's fields.
 * Rendered by: SessionWizard.tsx (step 2)
 */
export function PreferencesStep({ draft, onChange }: PreferencesStepProps) {
  const { preferences } = draft;
  const [window, setWindow] = useState<'answers' | 'instructions' | null>(null);
  // Typed in the window and kept only when the user presses Save there.
  const [instructions, setInstructions] = useState(draft.instructions);

  return (
    <div className="flex flex-col gap-5">
      <SummaryRow title="Answer preferences" action="Change" onOpen={() => setWindow('answers')}>
        {styleSummary(preferences.style)}
      </SummaryRow>
      <SummaryRow
        title="AI instructions"
        action="Edit"
        onOpen={() => {
          setInstructions(draft.instructions);
          setWindow('instructions');
        }}
      >
        {draft.instructions.trim() || 'None yet. Tell Kite who you are and how to answer.'}
      </SummaryRow>
      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          label="Answer language"
          options={ANSWER_LANGUAGES}
          value={preferences.language}
          onChange={(language) => onChange({ preferences: { ...preferences, language } })}
          hint="Answers use this language. Live transcription is English-only for now."
        />
        <Select
          label="Model"
          options={MODEL_OPTIONS}
          value={preferences.model}
          onChange={(model) => onChange({ preferences: { ...preferences, model } })}
        />
      </div>
      <Textarea
        label="Key terms (optional)"
        value={preferences.keyTerms}
        onChange={(event) =>
          onChange({ preferences: { ...preferences, keyTerms: event.target.value } })
        }
        hint="Names and terms Kite should listen for, one per line: people, products, companies. They help the transcript spell them right."
        rows={4}
        maxLength={5_000}
      />
      <Toggle
        label="Save transcript"
        hint="Keeps the transcript on this computer after the call. Off: it is discarded when the call ends. Kite's answers, with your ratings and notes, are always kept on this computer (until you delete the session), so you can review them and Kite can learn from them."
        checked={draft.saveTranscript}
        onChange={(saveTranscript) => onChange({ saveTranscript })}
      />
      <Toggle
        label="Auto-answer (beta)"
        hint="Answers by itself when the other person finishes a question. At most one automatic answer every 15 seconds. Settings can also turn this on for every session."
        checked={draft.autoAnswer}
        onChange={(autoAnswer) => onChange({ autoAnswer })}
      />

      <AnswerPreferencesDialog
        open={window === 'answers'}
        onClose={() => setWindow(null)}
        style={preferences.style}
        language={preferences.language}
        onApply={(style) => onChange({ preferences: { ...preferences, style } })}
      />
      <Dialog
        open={window === 'instructions'}
        onClose={() => setWindow(null)}
        title="AI instructions"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWindow(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onChange({ instructions });
                setWindow(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Textarea
          label="Context for Kite"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          hint="Who you are, how you like to answer, and anything to always or never mention. For example: answer as a solutions engineer; mention the 30-day trial when relevant."
          rows={8}
          maxLength={5_000}
        />
      </Dialog>
    </div>
  );
}
