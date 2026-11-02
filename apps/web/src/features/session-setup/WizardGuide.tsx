/**
 * File: apps/web/src/features/session-setup/WizardGuide.tsx
 * Purpose: The left panel of the Create session wizard's first step: "View tutorial" (a short window
 *          on how a session works) and three mock presets that fill in an invented practice role.
 * Used by: src/features/session-setup/SessionWizard.tsx (create mode only: a preset would overwrite
 *          the details of a session being edited)
 * Depends on: src/ui (Button, Dialog, icons), ./draft.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Create session);
 *               docs/design/kite-ui-theme.md §6
 */
'use client';

import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { PlayIcon, WebcamIcon } from '@/ui/icons';
import type { SessionDraft } from './draft';

/** Props for WizardGuide. */
export interface WizardGuideProps {
  /** Applies a preset's fields to the draft. */
  onPreset: (changes: Partial<SessionDraft>) => void;
}

/** The mock presets: invented practice roles, written for Kite. */
const PRESETS: readonly {
  /** The button's words. */
  label: string;
  /** The role it fills in. */
  role: string;
  /** What the invented job asks for. */
  description: string;
}[] = [
  {
    label: 'Software engineer',
    role: 'Software engineer',
    description:
      'Practice interview for a software engineer: coding basics, system design, debugging a live problem, and working with a team.',
  },
  {
    label: 'Product manager',
    role: 'Product manager',
    description:
      'Practice interview for a product manager: choosing what to build, using data to decide, working with engineers and handling a launch that slips.',
  },
  {
    label: 'Customer success',
    role: 'Customer success manager',
    description:
      'Practice interview for a customer success manager: onboarding, renewals, handling an unhappy customer and spotting accounts at risk.',
  },
];

/** The tutorial's steps. */
const STEPS: readonly string[] = [
  'Create a session: who the call is with, and the resume and documents Kite should use.',
  'Start the session and connect both sides: your microphone and the other person’s audio.',
  'During the call, press Answer when they ask something. Kite writes a short answer from your session.',
  'After the call, read the notes and rate answers, so Kite learns what you prefer.',
];

/**
 * The wizard's left panel.
 *
 * @param props See WizardGuideProps.
 * @returns The panel and its tutorial window.
 * Rendered by: SessionWizard.tsx (step 1, create mode)
 */
export function WizardGuide({ onPreset }: WizardGuideProps) {
  const [tutorial, setTutorial] = useState(false);
  return (
    <aside
      aria-label="Getting started"
      className="flex flex-col gap-5 rounded-card border border-ui-border bg-ui-surface p-5 shadow-card"
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-ui-heading">New to Kite?</h2>
        <p className="text-[13px] text-ui-muted">See how a session works, in four short steps.</p>
        <Button variant="secondary" size="sm" onClick={() => setTutorial(true)}>
          <PlayIcon />
          View tutorial
        </Button>
      </div>
      <div className="flex flex-col gap-2 border-t border-ui-border pt-5">
        <h2 className="text-[15px] font-semibold text-ui-heading">Mock presets</h2>
        <p className="text-[13px] text-ui-muted">Fill in a practice role, then change anything.</p>
        {PRESETS.map((preset) => (
          <Button
            key={preset.role}
            variant="secondary"
            size="sm"
            className="justify-start text-left"
            onClick={() =>
              onPreset({
                type: 'mock',
                company: 'Practice',
                role: preset.role,
                description: preset.description,
              })
            }
          >
            <WebcamIcon />
            {preset.label}
          </Button>
        ))}
      </div>

      <Dialog open={tutorial} onClose={() => setTutorial(false)} title="How a session works">
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ui-subtle text-[13px] font-medium text-ui-heading"
              >
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Dialog>
    </aside>
  );
}
