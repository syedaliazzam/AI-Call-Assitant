/**
 * File: apps/web/src/features/session-setup/PreferencesStep.tsx
 * Purpose: Step 2 of the Create/Edit session wizard (spec S5), as rows with an icon, a title, a line and
 *          a control. Session: Language (a list with a search box), Select model (v1.3.0: was Model), Answer preferences and AI
 *          instructions (each its own window). Extra: Auto answer and Save transcript.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: lucide-react, src/core/documents/limits.ts (the deeper-model warning, ADR-0067),
 *             src/core/session/modelAccess.ts, src/core/storage/types.ts, src/ui (Button,
 *             Select, Toggle), ./AiInstructionsDialog.tsx, ./AnswerPreferencesDialog.tsx, ./draft.ts,
 *             ./labels.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S5), §6
 */
'use client';

import {
  Cpu,
  Languages,
  Mail,
  MessagesSquare,
  MessageSquareText,
  Plus,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { DEEP_MODEL_WARNING, documentWarnings } from '@/core/documents/limits';
import {
  answerModelAccess,
  DEFAULT_MODEL_ACCESS,
  type AnswerModelAccess,
} from '@/core/session/modelAccess';
import { modelOff } from '@/core/session/modelChoices';
import { ANSWER_LANGUAGES, type AnswerModel } from '@/core/storage/types';
import { parseAddressList } from '@/core/drive/addresses';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Switch } from '@/ui/Toggle';
import { AiInstructionsDialog } from './AiInstructionsDialog';
import { AnswerPreferencesDialog } from './AnswerPreferencesDialog';
import { draftChars, type SessionDraft } from './draft';
import { modelOptions } from './labels';

/** Props for PreferencesStep. */
export interface PreferencesStepProps {
  /** The wizard's draft. */
  draft: SessionDraft;
  /** Applies changes to the draft. */
  onChange: (changes: Partial<SessionDraft>) => void;
}

/** The rows' icons (spec S5: 20 px). */
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** How much of the instructions a row shows (spec S5). */
const INSTRUCTIONS_PREVIEW_CHARS = 40;

/**
 * One row: an icon, what the setting is, one line about it, and its control.
 *
 * @param props.icon     The icon.
 * @param props.title    What it is.
 * @param props.subtitle One line about it.
 * @param props.control  The control at the right.
 * @returns The row.
 * Rendered by: PreferencesStep
 */
function Row({
  icon,
  title,
  subtitle,
  control,
}: {
  /** The icon. */
  icon: ReactNode;
  /** What it is. */
  title: string;
  /** One line about it. */
  subtitle: string;
  /** The control at the right. */
  control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <span className="shrink-0 text-ui-muted">{icon}</span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-label text-ui-heading">{title}</p>
        <p className="truncate text-helper text-ui-muted">{subtitle}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
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
  // ADR-0095: Groq starts unavailable until the server says it has it. ADR-0099: the Gemini and GPT models
  // too, and the list is the classic one until the server says this account is in their rollout.
  const [access, setAccess] = useState<AnswerModelAccess>(DEFAULT_MODEL_ACCESS);
  const instructions = draft.instructions.trim();
  // The Sonnet line only: the size warning itself is on step 1, next to the documents.
  const deepModelWarning = documentWarnings(draftChars(draft), preferences.model).includes(
    DEEP_MODEL_WARNING,
  );

  // An admin can turn the deeper model, or Groq, off. The server enforces it either way: this only says so.
  useEffect(() => {
    let cancelled = false;
    void answerModelAccess().then((next) => {
      if (!cancelled) setAccess(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Session" className="flex flex-col gap-1">
        <h2 className="text-section text-ui-muted">Session</h2>
        <Row
          icon={<Languages {...ICON} />}
          title="Language"
          subtitle="Language of the answers"
          control={
            <div className="w-40">
              <Select
                label="Language"
                hideLabel
                align="end"
                searchable
                searchPlaceholder="Search language"
                options={ANSWER_LANGUAGES}
                value={preferences.language}
                onChange={(language) => onChange({ preferences: { ...preferences, language } })}
              />
            </div>
          }
        />
        <Row
          icon={<Cpu {...ICON} />}
          title="Select model"
          subtitle="Speed or depth"
          control={
            // ADR-0099: the rollout's names are longer, so its list is wider.
            <div className={access.moreModels ? 'w-72' : 'w-56'}>
              <Select<AnswerModel>
                label="Select model"
                hideLabel
                align="end"
                options={modelOptions(access.moreModels).map((option) => ({
                  ...option,
                  icon: <Sparkles aria-hidden="true" size={16} className="text-ui-muted" />,
                  // ADR-0099: any choice that is off for this account (modelOff()).
                  ...(modelOff(option.value, access) ? { disabled: true, tag: 'Turned off' } : {}),
                }))}
                value={preferences.model}
                onChange={(model) => onChange({ preferences: { ...preferences, model } })}
              />
            </div>
          }
        />
        {/* ADR-0067: Sonnet reads every document on each live answer at its own price. */}
        {deepModelWarning && (
          <p className="text-[13px] text-ui-warning" role="status">
            {DEEP_MODEL_WARNING}
          </p>
        )}
        <Row
          icon={<MessageSquareText {...ICON} />}
          title="Answer preferences"
          subtitle="How answers look"
          control={
            <Button variant="secondary" onClick={() => setWindow('answers')}>
              <Settings aria-hidden="true" size={16} />
              Configure
            </Button>
          }
        />
        <Row
          icon={<Sparkles {...ICON} />}
          title="AI instructions"
          subtitle={
            instructions
              ? instructions.length > INSTRUCTIONS_PREVIEW_CHARS
                ? `${instructions.slice(0, INSTRUCTIONS_PREVIEW_CHARS)}…`
                : instructions
              : 'Extra guidance for this call'
          }
          control={
            <Button variant="secondary" onClick={() => setWindow('instructions')}>
              {!instructions && <Plus aria-hidden="true" size={16} />}
              {instructions ? 'Edit' : 'Add'}
            </Button>
          }
        />
      </section>

      <section aria-label="Extra" className="flex flex-col gap-1">
        <h2 className="text-section text-ui-muted">Extra</h2>
        <Row
          icon={<Zap {...ICON} />}
          title="Auto answer"
          subtitle="Answer questions automatically"
          control={
            <Switch
              ariaLabel="Auto answer"
              checked={draft.autoAnswer}
              onChange={(autoAnswer) => onChange({ autoAnswer })}
            />
          }
        />
        <Row
          icon={<MessagesSquare {...ICON} />}
          title="Save transcript"
          subtitle="Others may need to agree to recording"
          control={
            <Switch
              ariaLabel="Save transcript"
              checked={draft.saveTranscript}
              onChange={(saveTranscript) => onChange({ saveTranscript })}
            />
          }
        />
        <AlsoNotifyRow
          value={draft.driveAlsoNotify}
          onChange={(driveAlsoNotify) => onChange({ driveAlsoNotify })}
        />
      </section>

      <AnswerPreferencesDialog
        open={window === 'answers'}
        onClose={() => setWindow(null)}
        style={preferences.style}
        onApply={(style) => onChange({ preferences: { ...preferences, style } })}
      />
      <AiInstructionsDialog
        open={window === 'instructions'}
        onClose={() => setWindow(null)}
        value={draft.instructions}
        onSave={(next) => onChange({ instructions: next })}
      />
    </div>
  );
}

/**
 * 1.6.0 (ADR-0072): who else gets this session's "saved to Google Drive" email. Empty: the list in
 * Settings. Entries that are not email addresses are named under the field and not saved.
 *
 * @param props.value    The typed list.
 * @param props.onChange Called with the new text.
 * @returns The row.
 * Rendered by: PreferencesStep
 */
function AlsoNotifyRow({
  value,
  onChange,
}: {
  /** The typed list. */
  value: string;
  /** Called with the new text. */
  onChange: (value: string) => void;
}) {
  const parsed = parseAddressList(value);
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-ui-muted">
          <Mail {...ICON} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label text-ui-heading">Also notify</p>
          <p className="text-helper text-ui-muted">
            Who else gets the email when this session is saved to Google Drive. Empty: the list in
            Settings.
          </p>
        </div>
      </div>
      <Input
        label="Also notify for this session"
        hideLabel
        type="text"
        inputMode="email"
        placeholder="name@company.com, teammate@company.com"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={
          parsed.invalid.length > 0
            ? `Not an email address (not saved): ${parsed.invalid.join(', ')}`
            : parsed.tooMany
              ? 'At most 20 addresses; the rest are not saved.'
              : undefined
        }
      />
    </div>
  );
}
