/**
 * File: apps/web/src/features/session-setup/AnswerPreferencesDialog.tsx
 * Purpose: The Answer preferences window (spec S6), in two panes. Left: Format, Length and Tone, each
 *          opening a view of radio cards in place of the list, with Set as default and Save. Right: a
 *          live preview for a chosen question type, from hand-written samples, so it changes at once
 *          and never calls the API.
 * Used by: src/features/session-setup/PreferencesStep.tsx
 * Depends on: lucide-react, src/core/storage (settings, types), src/features/preferences/previewSamples.ts,
 *             ./labels.ts, src/ui (Button, Chip, Modal, RadioCard, Select, Toggle, Tooltip)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S6), §6 (STAR)
 */
'use client';

import { AudioLines, ChevronRight, Gauge, Info, List } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { getSessionDefaults, saveSessionDefaults } from '@/core/storage/settings';
import type { AnswerStyle } from '@/core/storage/types';
import {
  renderSample,
  SAMPLE_QUESTION_OPTIONS,
  type SampleQuestionType,
} from '@/features/preferences/previewSamples';
import { Button } from '@/ui/Button';
import { SOON_TOOLTIP, SoonBadge } from '@/ui/Chip';
import { Modal } from '@/ui/Modal';
import { RadioCards } from '@/ui/RadioCard';
import { Select } from '@/ui/Select';
import { Switch } from '@/ui/Toggle';
import { Tooltip } from '@/ui/Tooltip';
import { FORMAT_OPTIONS, LENGTH_OPTIONS, optionLabel, TONE_OPTIONS } from './labels';

/** Props for AnswerPreferencesDialog. */
export interface AnswerPreferencesDialogProps {
  /** Whether it is open. */
  open: boolean;
  /** Closes it without changing anything. */
  onClose: () => void;
  /** The current style. */
  style: AnswerStyle;
  /** Takes the chosen style. */
  onApply: (style: AnswerStyle) => void;
}

/** Which view shows in the left pane. */
type View = 'list' | 'format' | 'length' | 'tone';

/** The words at the top of each view. */
const VIEW_WORDS: Readonly<Record<View, { title: string; subtitle: string }>> = {
  list: {
    title: 'Answer preferences',
    subtitle: 'Choose how answers are shaped. You can change this during a call too.',
  },
  format: { title: 'Format', subtitle: 'The shape that suits how you like to talk.' },
  length: { title: 'Length', subtitle: 'Shorter answers reach you sooner.' },
  tone: { title: 'Tone', subtitle: 'The wording that fits this call.' },
};

/**
 * Tells two styles apart, treating a missing STAR setting as off.
 *
 * @param a One style.
 * @param b The other.
 * @returns True when they would write the same answers.
 * Called from: PreferencesForm
 */
const sameStyle = (a: AnswerStyle, b: AnswerStyle) =>
  a.format === b.format &&
  a.length === b.length &&
  a.tone === b.tone &&
  Boolean(a.star) === Boolean(b.star);

/**
 * One row of the list: a 36 px icon tile, a title, the current value and a chevron.
 *
 * @param props.icon    The icon.
 * @param props.title   What it sets.
 * @param props.value   Its current value.
 * @param props.onClick Opens its view.
 * @returns The row.
 * Rendered by: PreferencesForm
 */
function ListRow({
  icon,
  title,
  value,
  onClick,
}: {
  /** The icon. */
  icon: ReactNode;
  /** What it sets. */
  title: string;
  /** Its current value. */
  value: string;
  /** Opens its view. */
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors duration-(--k-dur) hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-control bg-ui-bg text-ui-text"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label text-ui-heading">{title}</span>
        <span className="truncate text-helper text-ui-muted">{value}</span>
      </span>
      <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-ui-muted" />
    </button>
  );
}

/**
 * The window's contents, mounted only while open, so they always start from the session's style.
 *
 * @param props See AnswerPreferencesDialogProps.
 * @returns The modal.
 * Rendered by: AnswerPreferencesDialog
 */
function PreferencesForm({ style, onApply, onClose, open }: AnswerPreferencesDialogProps) {
  // The choices so far; Save hands them to the session.
  const [draft, setDraft] = useState(style);
  // What a drill-in view is trying out; Select keeps it, Back drops it. The preview shows it.
  const [trying, setTrying] = useState(style);
  const [view, setView] = useState<View>('list');
  const [question, setQuestion] = useState<SampleQuestionType>('behavioural');
  const [savedDefault, setSavedDefault] = useState<AnswerStyle | null>(null);

  /**
   * Opens a drill-in view.
   *
   * @param next The view.
   */
  function drillIn(next: View) {
    setTrying(draft);
    setView(next);
  }

  /** Saves the current choices as the default for new sessions (Settings). */
  async function setAsDefault() {
    const defaults = await getSessionDefaults();
    await saveSessionDefaults({ ...defaults, style: draft });
    setSavedDefault(draft);
  }

  const shown = view === 'list' ? draft : trying;
  const sample = renderSample(question, shown);
  const words = VIEW_WORDS[view];

  const footer =
    view === 'list' ? (
      <>
        <Button variant="ghost" size="lg" onClick={() => void setAsDefault()}>
          Set as default
        </Button>
        <Button
          size="lg"
          disabled={sameStyle(draft, style)}
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Save
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" size="lg" onClick={() => setView('list')}>
          Back
        </Button>
        <Button
          size="lg"
          onClick={() => {
            setDraft(trying);
            setView('list');
          }}
        >
          Select
        </Button>
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={words.title}
      subtitle={words.subtitle}
      width={920}
      height={540}
      fullScreenOnPhone
      footer={footer}
      aside={
        <>
          <Select
            label="Question type"
            options={SAMPLE_QUESTION_OPTIONS}
            value={question}
            onChange={setQuestion}
          />
          <section
            aria-label="Sample answer"
            className="flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto rounded-card border border-ui-border bg-ui-bg p-4 text-[15px] leading-relaxed"
          >
            <p className="text-helper text-ui-muted">{sample.question}</p>
            {sample.text && <p className="font-medium text-ui-heading">{sample.text}</p>}
            {sample.bullets.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {sample.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      }
    >
      {view === 'list' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col divide-y divide-ui-border overflow-hidden rounded-card bg-ui-panel">
            <ListRow
              icon={<List aria-hidden="true" size={18} />}
              title="Format"
              value={optionLabel(FORMAT_OPTIONS, draft.format)}
              onClick={() => drillIn('format')}
            />
            <ListRow
              icon={<Gauge aria-hidden="true" size={18} />}
              title="Length"
              value={optionLabel(LENGTH_OPTIONS, draft.length)}
              onClick={() => drillIn('length')}
            />
            <ListRow
              icon={<AudioLines aria-hidden="true" size={18} />}
              title="Tone"
              value={optionLabel(TONE_OPTIONS, draft.tone)}
              onClick={() => drillIn('tone')}
            />
          </div>
          {savedDefault && sameStyle(savedDefault, draft) && (
            <p role="status" className="text-helper text-ui-success">
              New sessions will start with these.
            </p>
          )}
        </div>
      )}
      {view === 'format' && (
        <div className="flex flex-col gap-4">
          <RadioCards
            label="Format"
            options={FORMAT_OPTIONS}
            value={trying.format}
            onChange={(format) => setTrying({ ...trying, format })}
          />
          <div className="flex flex-col gap-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-label text-ui-heading">STAR structure</span>
              <Tooltip content="For behavioural answers: Situation, Task, Action and Result, each from what your CV says.">
                <span tabIndex={0} aria-label="About STAR structure" className="inline-flex">
                  <Info aria-hidden="true" size={15} className="text-ui-muted" />
                </span>
              </Tooltip>
              <span className="flex-1" />
              <Switch
                ariaLabel="STAR structure"
                checked={Boolean(trying.star)}
                onChange={(star) => setTrying({ ...trying, star })}
              />
            </div>
            <div className="flex items-center gap-2 opacity-60">
              <span className="text-label text-ui-heading">Filler words</span>
              <span className="flex-1" />
              <Tooltip content={SOON_TOOLTIP}>
                <SoonBadge />
              </Tooltip>
            </div>
          </div>
        </div>
      )}
      {view === 'length' && (
        <RadioCards
          label="Length"
          options={LENGTH_OPTIONS}
          value={trying.length}
          onChange={(length) => setTrying({ ...trying, length })}
        />
      )}
      {view === 'tone' && (
        <RadioCards
          label="Tone"
          options={TONE_OPTIONS}
          value={trying.tone}
          onChange={(tone) => setTrying({ ...trying, tone })}
        />
      )}
    </Modal>
  );
}

/**
 * The Answer preferences window.
 *
 * @param props See AnswerPreferencesDialogProps.
 * @returns The window while open, otherwise nothing.
 * Rendered by: PreferencesStep.tsx
 */
export function AnswerPreferencesDialog(props: AnswerPreferencesDialogProps) {
  return props.open ? <PreferencesForm {...props} /> : null;
}
