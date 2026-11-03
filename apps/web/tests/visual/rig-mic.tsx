/**
 * File: apps/web/tests/visual/rig-mic.tsx
 * Purpose: The overlay rig's microphone check (v1.0.3, item 4): the Ask Kite page's real voice
 *          path (useVoiceInput → micSession: the platform microphone → the on-device speech engine
 *          → dictation, sent on a pause) with the real MicButton, so the desktop shell's permission
 *          flow and the engine can be tried with a real microphone. Shows the state, the words
 *          heard, what was sent and any error with its reason; exposes them on window.__mic for
 *          apps/desktop/tests/visual/mic-check.ts. Served at /mic by overlay-rig.ts.
 * Used by: tests/visual/overlay-rig.ts (bundled with esbuild)
 * Depends on: src/features/ask-kite (useVoiceInput, MicButton), react-dom
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 *
 * Nothing is sent anywhere: "sent" text only shows on this page.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MicButton } from '@/features/ask-kite/VoiceControls';
import { useVoiceInput } from '@/features/ask-kite/useVoiceInput';

/** What the check script reads. */
interface MicReport {
  /** The microphone's state. */
  state: string;
  /** The error, if any. */
  error: string | null;
  /** The words heard so far. */
  preview: string;
  /** What was sent after the pause. */
  sent: string[];
}

/**
 * The check page.
 *
 * @returns The page.
 */
function MicRig() {
  const [preview, setPreview] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const voice = useVoiceInput({
    onPreview: setPreview,
    onSend: (text) => setSent((all) => [...all, text]),
  });
  // The check script reads this.
  useEffect(() => {
    (window as unknown as { __mic: MicReport }).__mic = {
      state: voice.state,
      error: voice.error,
      preview,
      sent,
    };
  });
  return (
    <main className="k-dark flex min-h-screen flex-col gap-4 bg-ui-bg p-6 text-ui-text">
      <h1 className="text-[20px] font-semibold">Microphone check (Ask Kite voice path)</h1>
      <div className="flex items-center gap-3">
        <MicButton
          state={voice.state}
          disabled={false}
          onStart={() => voice.start('')}
          onStop={voice.stop}
        />
        <span aria-label="Microphone state" className="text-[15px]">
          State: {voice.state}
        </span>
      </div>
      {voice.error && (
        <p role="alert" className="text-[15px] text-ui-danger">
          Error: {voice.error}
        </p>
      )}
      <p className="text-[15px]">Heard: {preview || '—'}</p>
      <p className="text-[15px]">Sent: {sent.join(' | ') || '—'}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<MicRig />);
