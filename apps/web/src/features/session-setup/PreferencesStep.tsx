/**
 * File: apps/web/src/features/session-setup/PreferencesStep.tsx
 * Purpose: Step 2 of the Create/Edit session wizard, as rows with an icon: Language, Model (Fast or
 *          Accurate), Answer preferences (a window with a preview) and AI instructions (their own
 *          window); then Extra: key terms (names and terms to listen for, which become speech-to-
 *          text hotwords), Auto-answer (beta) and Save transcript with a consent note.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: src/ui (Button, Dialog, Textarea, Toggle, icons), ./draft.ts, ./labels.ts,
 *             ./AnswerPreferencesDialog.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F3), §5; ADR-0029;
 *               docs/design/kite-ui-theme.md §6
 */
'use client';

import { parseKeyTerms } from '@kite/shared';
import { useState, type ReactNode } from 'react';
import { ANSWER_LANGUAGES, type AnswerModel } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import {
  BoltIcon,
  GlobeIcon,
  PenIcon,
  SaveIcon,
  SlidersIcon,
  SparkIcon,
  TagIcon,
} from '@/ui/icons';
import { Textarea } from '@/ui/Textarea';
import { Toggle } from '@/ui/Toggle';
import { AnswerPreferencesDialog } from './AnswerPreferencesDialog';
import type { SessionDraft } from './draft';
import { styleSummary } from './labels';

/** Props for PreferencesStep. */
export interface PreferencesStepProps {
  /** The wizard's draft. */
  draft: SessionDraft;
  /** Applies changes to the draft. */
  onChange: (changes: Partial<SessionDraft>) => void;
}

/** The model choice's two words; the stored values stay 'fast' and 'smart'. */
const MODEL_CHOICES: readonly { value: AnswerModel; label: string }[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'smart', label: 'Accurate' },
];

/**
 * One row of the step: an icon, what the setting is, one line about it, and its control.
 *
 * @param props.icon        The icon.
 * @param props.title       What it is.
 * @param props.description One line about it.
 * @param props.control     The control at the right.
 * @returns The row.
 * Rendered by: PreferencesStep
 */
function Row({
  icon,
  title,
  description,
  control,
}: {
  /** The icon. */
  icon: ReactNode;
  /** What it is. */
  title: string;
  /** One line about it. */
  description: ReactNode;
  /** The control at the right. */
  control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-4">
      <RowIcon>{icon}</RowIcon>
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-[15px] font-medium text-ui-heading">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-ui-muted">{description}</p>
      </div>
      {control}
    </div>
  );
}

/**
 * The round tile behind a row's icon.
 *
 * @param props.children The icon.
 * @returns The tile.
 * Rendered by: Row, PreferencesStep
 */
function RowIcon({
  children,
}: {
  /** The icon. */
  children: ReactNode;
}) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ui-subtle text-ui-heading">
      {children}
    </span>
  );
}

/**
 * The key terms as Kite will use them, one chip each (split on commas, semicolons and new lines,
 * trimmed, deduplicated, each at most 60 characters), so a pasted list shows how it was read.
 *
 * @param props.text The key-terms box's text.
 * @returns The chips, or nothing when there are no terms.
 * Rendered by: PreferencesStep
 */
function KeyTermChips({
  text,
}: {
  /** The key-terms box's text. */
  text: string;
}) {
  const terms = parseKeyTerms(text);
  if (terms.length === 0) return null;
  return (
    <ul aria-label="Key terms Paramount AI will use" className="mt-2 flex flex-wrap gap-1.5">
      {terms.map((term) => (
        <li
          key={term}
          className="rounded-full border border-ui-border bg-ui-subtle px-2.5 py-0.5 text-[13px] text-ui-text"
        >
          {term}
        </li>
      ))}
    </ul>
  );
}

/**
 * Step 2: preferences.
 *
 * @param props See PreferencesStepProps.
 * @returns The step's rows and windows.
 * Rendered by: SessionWizard.tsx (step 2)
 */
export function PreferencesStep({ draft, onChange }: PreferencesStepProps) {
  const { preferences } = draft;
  const [window, setWindow] = useState<'answers' | 'instructions' | null>(null);
  // Typed in the window and kept only when the user presses Save there.
  const [instructions, setInstructions] = useState(draft.instructions);
  const hasInstructions = draft.instructions.trim() !== '';
  const instructionsAction = hasInstructions ? 'Edit' : 'Add';

  return (
    <div className="flex flex-col divide-y divide-ui-border">
      <Row
        icon={<GlobeIcon />}
        title="Language"
        description="Answers use this language. Live transcription is English-only for now."
        control={
          <select
            aria-label="Answer language"
            value={preferences.language}
            onChange={(event) =>
              onChange({ preferences: { ...preferences, language: event.target.value } })
            }
            className="h-10 border border-ui-border bg-ui-input px-3 text-base text-ui-text focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 md:text-[15px]"
          >
            {ANSWER_LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        }
      />
      <Row
        icon={<SparkIcon />}
        title="Model"
        description="Fast is best for live answers. Accurate is slower and more careful."
        control={
          <div role="radiogroup" aria-label="Model" className="flex gap-1 rounded-control">
            {MODEL_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={preferences.model === choice.value}
                onClick={() => onChange({ preferences: { ...preferences, model: choice.value } })}
                className={[
                  'h-10 border px-3 text-[15px] font-medium focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11',
                  preferences.model === choice.value
                    ? 'border-ui-primary bg-ui-primary text-ui-on-primary'
                    : 'border-ui-border bg-ui-surface text-ui-text hover:bg-ui-hover',
                ].join(' ')}
              >
                {choice.label}
              </button>
            ))}
          </div>
        }
      />
      <Row
        icon={<SlidersIcon />}
        title="Answer preferences"
        description={styleSummary(preferences.style)}
        control={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setWindow('answers')}
            aria-label="Configure: Answer preferences"
          >
            Configure
          </Button>
        }
      />
      <Row
        icon={<PenIcon />}
        title="AI instructions"
        description={
          draft.instructions.trim() || 'None yet. Tell Paramount AI who you are and how to answer.'
        }
        control={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setInstructions(draft.instructions);
              setWindow('instructions');
            }}
            aria-label={`${instructionsAction}: AI instructions`}
          >
            {instructionsAction}
          </Button>
        }
      />

      <div className="flex flex-col gap-5 py-4">
        <h2 className="text-[15px] font-semibold text-ui-heading">Extra</h2>
        <div className="flex items-start gap-3">
          <RowIcon>
            <BoltIcon />
          </RowIcon>
          <Toggle
            label="Auto-answer (beta)"
            hint="Answers by itself when the other person finishes a question. At most one automatic answer every 15 seconds. Settings can also turn this on for every session."
            checked={draft.autoAnswer}
            onChange={(autoAnswer) => onChange({ autoAnswer })}
          />
        </div>
        <div className="flex items-start gap-3">
          <RowIcon>
            <SaveIcon />
          </RowIcon>
          <div className="flex min-w-0 flex-col gap-2">
            <Toggle
              label="Save transcript"
              hint="Keeps the transcript on this computer after the call. Off: it is discarded when the call ends. Paramount AI's answers, with your ratings and notes, are always kept on this computer (until you delete the session), so you can review them and Paramount AI can learn from them."
              checked={draft.saveTranscript}
              onChange={(saveTranscript) => onChange({ saveTranscript })}
            />
            <p className="rounded-control bg-ui-subtle px-3 py-2 text-[13px] text-ui-text">
              Saving a transcript of a call can need the other person’s consent. Check the rules
              where you and they are, and tell them when in doubt.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <RowIcon>
            <TagIcon />
          </RowIcon>
          <div className="min-w-0 flex-1">
            <Textarea
              label="Key terms (optional)"
              value={preferences.keyTerms}
              onChange={(event) =>
                onChange({ preferences: { ...preferences, keyTerms: event.target.value } })
              }
              hint="Names and terms Paramount AI should listen for, separated by commas or new lines: people, products, companies. They help the transcript spell them right."
              rows={3}
              maxLength={5_000}
            />
            <KeyTermChips text={preferences.keyTerms} />
          </div>
        </div>
      </div>

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
          label="Context for Paramount AI"
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
