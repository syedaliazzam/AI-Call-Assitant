/**
 * File: apps/web/src/features/admin/ai-settings/QualityPanel.tsx
 * Purpose: Admin → AI settings' "Quality check" for the live answers prompt (ADR-0089): runs 8
 *          representative scenarios with the draft (about $0.05), shows its score next to the live
 *          version's, a warning when the score drops by 0.3 or more or an honesty or format case fails,
 *          and each scenario's result. A finished check lets that exact draft be saved.
 * Used by: src/features/admin/ai-settings/PromptWorkspace.tsx
 * Depends on: React, lucide-react, @kite/shared (QualityCheckResponse), src/core/admin/aiTry.ts
 *             (runQualityCheck), src/ui (Badge, Button)
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useState } from 'react';
import { AlertTriangle, Gauge } from 'lucide-react';
import type { QualityCheckResponse } from '@kite/shared';
import { runQualityCheck } from '@/core/admin/aiTry';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';

/** Props for QualityPanel. */
export interface QualityPanelProps {
  /** The draft global prompt to check. */
  prompt: string;
  /** Called after a finished check with the save token and the exact prompt that was checked. */
  onChecked: (promptToken: string, sent: string) => void;
}

/** What a kind of scenario is called on the page. */
const KIND_LABEL = { honesty: 'Honesty', format: 'Format', quality: 'Quality' } as const;

/**
 * One score with its label.
 *
 * @param props.label The label.
 * @param props.value The score, or null when unknown.
 * @param props.tone  Its colour.
 * @param props.signed True for a change ("+0.2", no "/ 10").
 * @returns The block.
 * Rendered by: QualityPanel
 */
function Score({
  label,
  value,
  tone = 'text-ui-heading',
  signed = false,
}: {
  /** The label. */
  label: string;
  /** The score. */
  value: number | null;
  /** A text colour class. */
  tone?: string;
  /** True for a change. */
  signed?: boolean;
}) {
  return (
    <div className="min-w-[8rem] rounded-control border border-ui-border bg-ui-surface px-4 py-3">
      <p className="text-[12px] text-ui-muted">{label}</p>
      <p className={`mt-0.5 text-[26px] font-semibold tabular-nums leading-tight ${tone}`}>
        {value === null ? '–' : `${signed && value >= 0 ? '+' : ''}${value.toFixed(1)}`}
        {!signed && <span className="text-[14px] font-normal text-ui-muted"> / 10</span>}
      </p>
    </div>
  );
}

/**
 * The quality check.
 *
 * @param props See QualityPanelProps.
 * @returns The panel.
 * Rendered by: PromptWorkspace.tsx
 */
export function QualityPanel({ prompt, onChecked }: QualityPanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QualityCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Runs the check with the draft as it is now. */
  async function run() {
    setRunning(true);
    setError(null);
    const sent = prompt;
    const outcome = await runQualityCheck(sent);
    setRunning(false);
    if (outcome.ok) {
      setResult(outcome.result);
      onChecked(outcome.result.promptToken, sent);
    } else setError(outcome.message);
  }

  const delta = result && result.liveScore !== null ? result.score - result.liveScore : null;

  return (
    <section aria-label="Quality check" className="flex flex-col gap-4">
      <p className="text-[13px] text-ui-muted">
        Answers 8 typical questions with this draft (no CV, documents that cannot answer,
        behavioural with a CV, coding, a concept, small talk, nothing asked, the user&apos;s
        paragraph format) and grades them. About $0.05; the first check of a new live version also
        measures it once.
      </p>
      <div>
        <Button onClick={() => void run()} disabled={running}>
          <Gauge aria-hidden="true" size={14} className="mr-1.5" />
          {running ? 'Checking… (about 30 seconds)' : 'Run quality check'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-helper text-ui-danger">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite" className="flex flex-col gap-4" data-testid="quality-result">
          <div className="flex flex-wrap gap-3">
            <Score label="This draft" value={result.score} />
            <Score label="Live version" value={result.liveScore} tone="text-ui-text" />
            {delta !== null && (
              <Score
                label="Change"
                signed
                value={delta}
                tone={
                  delta <= -0.3 ? 'text-ui-danger' : delta >= 0 ? 'text-ui-success' : 'text-ui-text'
                }
              />
            )}
          </div>
          {result.warning ? (
            <div
              role="alert"
              className="flex gap-2 rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[14px] text-ui-text"
            >
              <AlertTriangle
                aria-hidden="true"
                size={16}
                className="mt-0.5 shrink-0 text-ui-warning"
              />
              <span>{result.warning} Check the cases below before saving.</span>
            </div>
          ) : (
            <p className="text-[14px] text-ui-success">
              No drop, and every honesty and format case passed.
            </p>
          )}
          <ul className="divide-y divide-ui-border rounded-control border border-ui-border">
            {result.scenarios.map((scenario) => (
              <li
                key={scenario.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] text-ui-heading">
                    {scenario.title}
                    <span className="text-[12px] text-ui-muted">{KIND_LABEL[scenario.kind]}</span>
                  </p>
                  {scenario.reason && (
                    <p className="mt-0.5 text-[13px] text-ui-muted">{scenario.reason}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[14px] tabular-nums text-ui-text">
                    {scenario.score.toFixed(1)}
                  </span>
                  {scenario.passed ? (
                    <Badge tone="success">Pass</Badge>
                  ) : (
                    <Badge tone="danger">Fail</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ui-muted">
            Cost of this check: about ${result.costDollars.toFixed(3)}.
          </p>
        </div>
      )}
    </section>
  );
}
