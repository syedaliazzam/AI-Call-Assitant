/**
 * File: apps/web/src/features/admin/ai-settings/PromptWorkspace.tsx
 * Purpose: One tab of Admin → AI settings (ADR-0089): the global prompt's editor with an Edit / Preview
 *          switch, a sticky actions bar (Try it, Quality check for live answers, History, Discard, Reset
 *          to default, Save), the panel each opens, the lint hint for layout or personal-preference words,
 *          the input-budget warning (live answers), and the folded app contract. Save is allowed only for
 *          a draft that was tried or quality-checked exactly as it is (the server checks the token too).
 * Used by: src/features/admin/ai-settings/AiSettingsPage.tsx
 * Depends on: React, lucide-react, @kite/shared (lint, limits, budget), src/ui (Button, Input, Modal),
 *             ./PromptTextEditor.tsx, ./PromptPreview.tsx, ./TryPanel.tsx, ./QualityPanel.tsx,
 *             ./VersionHistory.tsx, ./ContractView.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Eye,
  FlaskConical,
  Gauge,
  History,
  Pencil,
  RotateCcw,
  Undo,
  X,
} from 'lucide-react';
import {
  answerBudgetUse,
  lintGlobalPrompt,
  MAX_GLOBAL_PROMPT_CHARS,
  MAX_VERSION_NOTE_CHARS,
  normaliseGlobalPrompt,
  PROMPT_LINT_MESSAGE,
  type AiInstructionBlock,
} from '@kite/shared';
import type { ToastTone } from '@/ui/Toast';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import {
  BLOCK_COPY,
  CARD,
  type BlockView,
  type BudgetView,
  type InstructionsActions,
} from './blocks';
import { ContractView } from './ContractView';
import { PromptPreview } from './PromptPreview';
import { PromptTextEditor } from './PromptTextEditor';
import { QualityPanel } from './QualityPanel';
import { TryPanel } from './TryPanel';
import { VersionHistory } from './VersionHistory';

/** Props for PromptWorkspace. */
export interface PromptWorkspaceProps {
  /** The tab. */
  block: AiInstructionBlock;
  /** Its state from the server. */
  view: BlockView;
  /** Live answers: the input-budget facts; null for the other tabs. */
  budget: BudgetView | null;
  /** The server actions. */
  actions: InstructionsActions;
  /** Shows a toast. */
  onToast: (text: string, tone?: ToastTone) => void;
  /** Tells the page whether this tab has unsaved changes. */
  onDirtyChange: (block: AiInstructionBlock, dirty: boolean) => void;
  /** Starting state (the visual rig and tests; the page starts in Edit with no panel). */
  initial?: WorkspaceStart;
}

/** A workspace's starting state (the visual rig and tests). */
export interface WorkspaceStart {
  /** Edit or Preview. */
  mode?: Mode;
  /** The panel open under the actions bar. */
  panel?: Panel;
  /** The draft in the editor (the live text when absent). */
  draft?: string;
  /**
   * True to count that draft as tried, so Save shows enabled. Display only: the server still checks a
   * real token on save.
   */
  tried?: boolean;
}

/** Edit or Preview. */
export type Mode = 'edit' | 'preview';

/** The panel open under the actions bar, if any. */
export type Panel = 'try' | 'quality' | 'history' | null;

/**
 * A button that opens or closes a panel.
 *
 * @param props.active   True while its panel is open.
 * @param props.onClick  Toggles it.
 * @param props.icon     Its icon.
 * @param props.children Its words.
 * @returns The button.
 * Rendered by: PromptWorkspace
 */
function PanelButton({
  active,
  onClick,
  icon,
  children,
}: {
  /** Open. */
  active: boolean;
  /** Toggle. */
  onClick: () => void;
  /** Icon. */
  icon: ReactNode;
  /** Words. */
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'primary' : 'secondary'}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {children}
    </Button>
  );
}

/**
 * One tab's workspace.
 *
 * @param props See PromptWorkspaceProps.
 * @returns The card with the bar, the panel, the editor or preview, the hints and the contract.
 * Rendered by: AiSettingsPage.tsx
 */
export function PromptWorkspace({
  block,
  view,
  budget,
  actions,
  onToast,
  onDirtyChange,
  initial,
}: PromptWorkspaceProps) {
  const copy = BLOCK_COPY[block];
  const live = view.activePrompt ?? view.defaultPrompt;
  const [draft, setDraft] = useState(initial?.draft ?? live);
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'edit');
  const [panel, setPanel] = useState<Panel>(initial?.panel ?? null);
  // Save tokens by the exact (cleaned) text they prove was tried or checked.
  const [tokens, setTokens] = useState<ReadonlyMap<string, string>>(
    () =>
      new Map(
        initial?.tried && initial.draft !== undefined
          ? [[normaliseGlobalPrompt(initial.draft), 'seeded']]
          : [],
      ),
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, startTransition] = useTransition();
  const hintId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousLive = useRef(live);

  const cleanDraft = normaliseGlobalPrompt(draft);
  const dirty = cleanDraft !== normaliseGlobalPrompt(live);
  const token = tokens.get(cleanDraft);
  const isDefaultLive = view.activePrompt === null;

  // After a save, reset or restore the page gets the new version: an untouched draft follows it.
  useEffect(() => {
    if (normaliseGlobalPrompt(draft) === normaliseGlobalPrompt(previousLive.current))
      setDraft(live);
    previousLive.current = live;
    // Only a new live text should move the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => onDirtyChange(block, dirty), [block, dirty, onDirtyChange]);

  const hints = useMemo(
    () => lintGlobalPrompt(draft, view.defaultPrompt),
    [draft, view.defaultPrompt],
  );
  const hintLines = useMemo(() => new Set(hints.map((hint) => hint.line)), [hints]);
  const budgetUse = budget
    ? answerBudgetUse({ ...budget, chars: cleanDraft.length + budget.headingChars })
    : null;

  /**
   * Keeps the token of a try or check (only while the draft is still that text, it enables Save).
   *
   * @param promptToken The token.
   * @param sent        The prompt that was tried.
   */
  const remember = (promptToken: string, sent: string) => {
    if (!promptToken) return;
    setTokens((current) => new Map(current).set(normaliseGlobalPrompt(sent), promptToken));
  };

  /**
   * Opens a panel, or closes it when it is open, and brings it into view.
   *
   * @param next The panel.
   */
  const toggle = (next: Exclude<Panel, null>) => {
    setPanel((current) => (current === next ? null : next));
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  /** Saves the tried draft with the note. */
  const save = () => {
    if (!token) return;
    startTransition(async () => {
      try {
        const result = await actions.save(block, draft, token, note);
        if (!result.ok) onToast(result.error, 'danger');
        else {
          onToast(
            result.created
              ? `${copy.label} saved. New calls use it; running calls keep their version.`
              : 'Nothing changed: this is already the live version.',
            'success',
          );
          setSaveOpen(false);
          setNote('');
        }
      } catch {
        onToast('Something went wrong. Please try again.', 'danger');
      }
    });
  };

  /** Goes back to the default prompt (a new version). */
  const reset = () => {
    startTransition(async () => {
      try {
        const result = await actions.reset(block);
        if (!result.ok) onToast(result.error, 'danger');
        else {
          setDraft(view.defaultPrompt);
          onToast(
            result.created
              ? `${copy.label} reset to the default prompt.`
              : 'The default prompt is already live.',
            'success',
          );
          setResetOpen(false);
        }
      } catch {
        onToast('Something went wrong. Please try again.', 'danger');
      }
    });
  };

  const panelTitle =
    panel === 'try'
      ? 'Try it'
      : panel === 'quality'
        ? 'Quality check'
        : panel === 'history'
          ? 'History'
          : '';

  return (
    <div className={`${CARD} flex flex-col`}>
      {/* The actions bar stays in view while the prompt scrolls. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-card border-b border-ui-border bg-ui-surface/95 px-4 py-3 backdrop-blur">
        <div
          role="group"
          aria-label="Edit or preview"
          className="inline-flex rounded-control border border-ui-border p-0.5"
        >
          {(
            [
              { value: 'edit', label: 'Edit', icon: <Pencil aria-hidden="true" size={14} /> },
              { value: 'preview', label: 'Preview', icon: <Eye aria-hidden="true" size={14} /> },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] ${
                mode === option.value
                  ? 'bg-ui-primary text-ui-on-primary'
                  : 'text-ui-text hover:bg-ui-hover'
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 text-[13px]" aria-live="polite">
          {dirty ? (
            <>
              <span aria-hidden="true" className="size-2 rounded-full bg-ui-dot-warning" />
              <span className="text-ui-warning">Unsaved changes</span>
              {token && (
                <span className="inline-flex items-center gap-1 text-ui-success">
                  · <Check aria-hidden="true" size={13} /> Tried
                </span>
              )}
            </>
          ) : (
            <span className="text-ui-muted">No unsaved changes</span>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PanelButton
            active={panel === 'try'}
            onClick={() => toggle('try')}
            icon={<FlaskConical aria-hidden="true" size={14} className="mr-1.5" />}
          >
            Try it
          </PanelButton>
          {block === 'live' && (
            <PanelButton
              active={panel === 'quality'}
              onClick={() => toggle('quality')}
              icon={<Gauge aria-hidden="true" size={14} className="mr-1.5" />}
            >
              Quality check
            </PanelButton>
          )}
          <PanelButton
            active={panel === 'history'}
            onClick={() => toggle('history')}
            icon={<History aria-hidden="true" size={14} className="mr-1.5" />}
          >
            History
          </PanelButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-ui-border" />
          <Button
            size="sm"
            variant="plain"
            disabled={!dirty || busy}
            onClick={() => setDraft(live)}
          >
            <Undo aria-hidden="true" size={14} className="mr-1.5" />
            Discard
          </Button>
          <Button
            size="sm"
            variant="plain"
            disabled={
              busy || (isDefaultLive && cleanDraft === normaliseGlobalPrompt(view.defaultPrompt))
            }
            onClick={() => setResetOpen(true)}
          >
            <RotateCcw aria-hidden="true" size={14} className="mr-1.5" />
            Reset to default
          </Button>
          <Button
            size="sm"
            disabled={!dirty || !token || busy || cleanDraft.length > MAX_GLOBAL_PROMPT_CHARS}
            title={
              dirty && !token ? 'Run Try it or Quality check on this exact draft first' : undefined
            }
            onClick={() => setSaveOpen(true)}
          >
            Save
          </Button>
        </div>
        {dirty && !token && (
          <p className="basis-full text-[12px] text-ui-muted">
            {`Save unlocks after Try it${block === 'live' ? ' or Quality check' : ''} runs on this exact draft.`}
          </p>
        )}
      </div>

      {panel && (
        <div ref={panelRef} className="border-b border-ui-border bg-ui-subtle/40 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ui-heading">{panelTitle}</h2>
            <Button
              size="sm"
              variant="plain"
              aria-label={`Close ${panelTitle}`}
              onClick={() => setPanel(null)}
            >
              <X aria-hidden="true" size={15} />
            </Button>
          </div>
          {/* Kept mounted while open; each panel uses the draft as it is when it runs. */}
          {panel === 'try' && <TryPanel block={block} prompt={draft} onTried={remember} />}
          {panel === 'quality' && <QualityPanel prompt={draft} onChecked={remember} />}
          {panel === 'history' && (
            <VersionHistory block={block} view={view} restore={actions.restore} onToast={onToast} />
          )}
        </div>
      )}

      {mode === 'edit' ? (
        <PromptTextEditor
          label={`${copy.label} global prompt`}
          value={draft}
          onChange={setDraft}
          maxLength={MAX_GLOBAL_PROMPT_CHARS}
          hintLines={hintLines}
          {...(hints.length > 0 ? { describedBy: hintId } : {})}
        />
      ) : (
        <div className="px-6 py-6 sm:px-8">
          <PromptPreview text={draft} />
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-ui-border px-4 py-4">
        {hints.length > 0 && (
          <div
            id={hintId}
            className="flex gap-2 rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
          >
            <AlertTriangle
              aria-hidden="true"
              size={15}
              className="mt-0.5 shrink-0 text-ui-warning"
            />
            <div>
              <p>{PROMPT_LINT_MESSAGE}</p>
              <p className="mt-0.5 text-ui-muted">
                {hints
                  .slice(0, 6)
                  .map((hint) => `Line ${hint.line} (${hint.terms.join(', ')})`)
                  .join(' · ')}
                {hints.length > 6 ? ` · and ${hints.length - 6} more` : ''}
              </p>
            </div>
          </div>
        )}
        {budgetUse?.near && (
          <p role="status" className="text-[13px] text-ui-warning">
            The largest live request would use about {Math.round(budgetUse.share * 100)}% of the
            input budget ({budgetUse.largestTokens.toLocaleString('en-US')} of{' '}
            {budgetUse.budgetTokens.toLocaleString('en-US')} tokens). A shorter prompt leaves more
            room for documents and the call.
          </p>
        )}
        <ContractView parts={view.contract} />
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={`Save ${copy.label}?`}
        subtitle="It becomes the live version for every user."
        closeOnBackdrop={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save and make live'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-ui-text">
            Calls started after saving use this version. Calls already running keep the version they
            started with. Each user&apos;s own AI preferences still win where they differ.
          </p>
          <Input
            label="Note for the history (optional)"
            value={note}
            maxLength={MAX_VERSION_NOTE_CHARS}
            placeholder="For example: shorter sales answers"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`Reset ${copy.label} to the default prompt?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={reset}>
              {busy ? 'Resetting…' : 'Reset to default'}
            </Button>
          </div>
        }
      >
        <p className="text-[14px] text-ui-text">
          The default prompt is saved as a new version and becomes live for new calls. Your current
          text stays in History, so you can restore it. Unsaved changes in the editor are replaced.
        </p>
      </Modal>
    </div>
  );
}
