/**
 * File: apps/web/src/features/session-setup/PreferencesStep.tsx
 * Purpose: Step 2 of the Create/Edit session wizard: language (English only in v1), model,
 *          answer format / length / tone, AI instructions, key terms (names and terms to listen
 *          for, which become speech-to-text hotwords), save-transcript and auto-answer (beta,
 *          Day 6) toggles.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: src/ui (Select, Textarea, Toggle), ./draft.ts, ./labels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F3), §5; day-03-sessions.md
 *               Stage 3
 */
'use client';

import type { AnswerStyle } from '@/core/storage/types';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { Toggle } from '@/ui/Toggle';
import type { SessionDraft } from './draft';
import { FORMAT_OPTIONS, LENGTH_OPTIONS, MODEL_OPTIONS, TONE_OPTIONS } from './labels';

/** Props for PreferencesStep. */
export interface PreferencesStepProps {
  /** The wizard's draft. */
  draft: SessionDraft;
  /** Applies changes to the draft. */
  onChange: (changes: Partial<SessionDraft>) => void;
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

  /**
   * Changes one part of the answer style.
   *
   * @param changes The style fields to change.
   */
  function setStyle(changes: Partial<AnswerStyle>) {
    onChange({ preferences: { ...preferences, style: { ...preferences.style, ...changes } } });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          label="Language"
          options={[{ value: 'en', label: 'English' }]}
          value={preferences.language}
          onChange={() => undefined}
          disabled
          hint="English only in this version."
        />
        <Select
          label="Model"
          options={MODEL_OPTIONS}
          value={preferences.model}
          onChange={(model) => onChange({ preferences: { ...preferences, model } })}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Select
          label="Answer format"
          options={FORMAT_OPTIONS}
          value={preferences.style.format}
          onChange={(format) => setStyle({ format })}
        />
        <Select
          label="Length"
          options={LENGTH_OPTIONS}
          value={preferences.style.length}
          onChange={(length) => setStyle({ length })}
        />
        <Select
          label="Tone"
          options={TONE_OPTIONS}
          value={preferences.style.tone}
          onChange={(tone) => setStyle({ tone })}
        />
      </div>
      <Textarea
        label="AI instructions (optional)"
        value={draft.instructions}
        onChange={(event) => onChange({ instructions: event.target.value })}
        hint="For example: answer as a solutions engineer; mention the 30-day trial when relevant."
        rows={3}
        maxLength={5_000}
      />
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
        label="Auto-answer"
        hint="Beta on Day 6: answers automatically when the other person asks a question."
        checked={false}
        onChange={() => undefined}
        disabled
      />
    </div>
  );
}
