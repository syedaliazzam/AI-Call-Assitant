/**
 * File: apps/web/src/core/review/downloadTranscript.ts
 * Purpose: Hands a file to the browser as a download, and downloads one session's transcript as text
 *          from its saved lines and answers (the session card's menu, spec S3). The file stays on this
 *          device.
 * Used by: src/features/dashboard/SessionMenu.tsx, src/features/review/ConversationSection.tsx
 * Depends on: ./conversation.ts, src/core/storage (answers, utterances), src/core/transcript/display.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S3)
 */
import { listAnswers } from '../storage/answers';
import type { Session } from '../storage/types';
import { listUtterances } from '../storage/utterances';
import { displayTerms } from '../transcript/display';
import { conversationItems, transcriptFileName, transcriptText } from './conversation';

/**
 * Hands a file to the browser as a download.
 *
 * @param name The file's name.
 * @param type Its media type.
 * @param data Its contents.
 * Called from: downloadSessionTranscript(), ConversationSection.tsx
 */
export function downloadFile(name: string, type: string, data: BlobPart): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // The download has started; the address is no longer needed.
  URL.revokeObjectURL(url);
}

/**
 * Downloads a session's transcript as a text file.
 *
 * @param session     The session.
 * @param accountName The account's display name, on the user's turns (v1.3.2).
 * @returns Resolves once the download has started.
 * @throws Whatever reading this device's storage throws.
 * Called from: SessionMenu.tsx
 */
export async function downloadSessionTranscript(
  session: Session,
  accountName?: string | null,
): Promise<void> {
  const [lines, answers] = await Promise.all([listUtterances(session.id), listAnswers(session.id)]);
  downloadFile(
    transcriptFileName(session, 'txt'),
    'text/plain;charset=utf-8',
    transcriptText(session, conversationItems(lines, answers), displayTerms(session), accountName),
  );
}
