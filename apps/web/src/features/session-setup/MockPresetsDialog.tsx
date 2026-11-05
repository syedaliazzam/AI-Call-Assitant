/**
 * File: apps/web/src/features/session-setup/MockPresetsDialog.tsx
 * Purpose: The wizard's Mock presets (spec S4): fills in a practice role and makes the session a mock
 *          interview, ready to change. Everything in a preset is invented.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: lucide-react, ./draft.ts, src/ui (Button, Dialog)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4)
 */
'use client';

import { Bot } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import type { SessionDraft } from './draft';

/** Props for MockPresetsDialog. */
export interface MockPresetsDialogProps {
  /** Whether it is open. */
  open: boolean;
  /** Closes it. */
  onClose: () => void;
  /** Applies a preset to the draft. */
  onPreset: (changes: Partial<SessionDraft>) => void;
}

/** The presets. */
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

/**
 * The window of presets.
 *
 * @param props See MockPresetsDialogProps.
 * @returns The dialog.
 * Rendered by: SessionWizard.tsx
 */
export function MockPresetsDialog({ open, onClose, onPreset }: MockPresetsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Mock presets">
      <div className="flex flex-col gap-2">
        <p className="text-helper text-ui-muted">Fill in a practice role, then change anything.</p>
        {PRESETS.map((preset) => (
          <Button
            key={preset.role}
            variant="secondary"
            className="justify-start"
            onClick={() => {
              onPreset({
                type: 'mock',
                company: 'Practice',
                role: preset.role,
                description: preset.description,
              });
              onClose();
            }}
          >
            <Bot aria-hidden="true" size={18} strokeWidth={1.75} />
            {preset.label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
