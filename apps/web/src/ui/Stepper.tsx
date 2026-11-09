/**
 * File: apps/web/src/ui/Stepper.tsx
 * Purpose: The numbered steps in a modal's left rail (spec S4): 28 px circles joined by a 32 px line.
 *          The active or finished circle is filled with the accent and a pending one is outlined and
 *          muted; the line turns accent, over 200 ms, when the step before it is finished.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4)
 * Theme: tokens from src/ui/tokens/theme.css
 */
import { Fragment } from 'react';

/** Props for Stepper. */
export interface StepperProps {
  /** The steps' names, in order. */
  steps: readonly string[];
  /** The active step, counting from 0. */
  current: number;
}

/**
 * The steps, top to bottom.
 *
 * @param props See StepperProps.
 * @returns The list of steps.
 * Rendered by: SessionWizard.tsx
 */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol aria-label="Steps" className="flex flex-col">
      {steps.map((step, index) => {
        const reached = index <= current;
        return (
          <Fragment key={step}>
            {index > 0 && (
              // v1.3.1 (ADR-0058): the green fills the grey line from the top down over 200 ms.
              <li aria-hidden="true" className="relative ml-[13px] h-8 w-0.5 bg-ui-border">
                <span
                  className={`absolute inset-x-0 top-0 bg-ui-accent-fill transition-[height] duration-(--k-dur-slow) ease-(--k-ease-out) ${reached ? 'h-full' : 'h-0'}`}
                />
              </li>
            )}
            <li
              aria-current={index === current ? 'step' : undefined}
              className="flex items-center gap-3"
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[14px] font-medium transition-colors duration-(--k-dur-slow) ${reached ? 'bg-ui-accent-fill text-ui-on-accent' : 'border border-ui-control-strong text-ui-muted'}`}
              >
                {index + 1}
              </span>
              <span
                className={`text-[15px] ${index === current ? 'text-ui-heading' : 'text-ui-muted'}`}
              >
                {step}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
