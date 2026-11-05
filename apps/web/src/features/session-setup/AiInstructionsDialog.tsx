/**
 * File: apps/web/src/features/session-setup/AiInstructionsDialog.tsx
 * Purpose: The AI instructions window (spec S7): one large text box for this session's notes, with Clear
 *          and Save. Save is off until something changes.
 * Used by: src/features/session-setup/PreferencesStep.tsx
 * Depends on: React, src/ui (Button, Modal, Textarea)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S7)
 */
'use client';

import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { Textarea } from '@/ui/Textarea';

/** Most characters in a session's instructions (the server's limit is higher). */
const MAX_INSTRUCTIONS_CHARS = 5_000;

/** Props for AiInstructionsDialog. */
export interface AiInstructionsDialogProps {
  /** Whether it is open. */
  open: boolean;
  /** Closes it without changing anything. */
  onClose: () => void;
  /** The session's current instructions. */
  value: string;
  /** Takes the new instructions. */
  onSave: (value: string) => void;
}

/**
 * The window's contents, mounted only while open, so they always start from the session's text.
 *
 * @param props See AiInstructionsDialogProps.
 * @returns The modal.
 * Rendered by: AiInstructionsDialog
 */
function InstructionsForm({ open, onClose, value, onSave }: AiInstructionsDialogProps) {
  const [text, setText] = useState(value);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI instructions"
      subtitle="Notes the AI should use in this session, like company background or how you like to answer."
      width={560}
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={() => setText('')} disabled={text === ''}>
            Clear
          </Button>
          <Button
            size="lg"
            disabled={text === value}
            onClick={() => {
              onSave(text);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Textarea
        label="Context"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Role notes, company details, answer style…"
        rows={10}
        maxLength={MAX_INSTRUCTIONS_CHARS}
        counter
      />
    </Modal>
  );
}

/**
 * The AI instructions window.
 *
 * @param props See AiInstructionsDialogProps.
 * @returns The window while open, otherwise nothing.
 * Rendered by: PreferencesStep.tsx
 */
export function AiInstructionsDialog(props: AiInstructionsDialogProps) {
  return props.open ? <InstructionsForm {...props} /> : null;
}
