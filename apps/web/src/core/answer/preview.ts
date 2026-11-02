/**
 * File: apps/web/src/core/answer/preview.ts
 * Purpose: The Answer preview for the Answer preferences window: fetched once per combination of
 *          settings (POST /api/preview, one Haiku request) and kept in this browser, so looking at
 *          the same combination again costs nothing. Only when the user asks for it.
 * Used by: src/features/session-setup/AnswerPreferencesDialog.tsx
 * Depends on: @kite/shared (request and response types), the browser's fetch and localStorage
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 *
 * Previews are invented examples, not the user's content. Storage may be unavailable (a private
 * window), so every read and write is guarded; without it each look simply asks again.
 */
import type { AnswerPreviewRequest, AnswerPreviewResponse } from '@kite/shared';

/** What loading a preview gave. */
export type PreviewResult =
  | {
      /** It worked. */
      ok: true;
      /** The preview answer. */
      text: string;
    }
  | {
      /** It did not. */
      ok: false;
    };

/**
 * The storage key for one combination of settings.
 *
 * @param request The settings and question type.
 * @returns The key.
 * Called from: loadPreview(); tests
 */
export function previewKey(request: AnswerPreviewRequest): string {
  const { format, length, tone } = request.style;
  return `kite.preview.${format}.${length}.${tone}.${request.language ?? 'en'}.${request.question}`;
}

/**
 * The preview already kept for these settings.
 *
 * @param request The settings and question type.
 * @returns The text, or null when there is none (asking the server is a separate, paid step).
 * Called from: AnswerPreferencesDialog.tsx; tests
 */
export function keptPreview(request: AnswerPreviewRequest): string | null {
  return readKept(previewKey(request));
}

/**
 * Reads a kept preview.
 *
 * @param key The storage key.
 * @returns The text, or null.
 * Called from: loadPreview(), keptPreview()
 */
function readKept(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Keeps a preview.
 *
 * @param key  The storage key.
 * @param text The text.
 * Called from: loadPreview()
 */
function keep(key: string, text: string): void {
  try {
    localStorage.setItem(key, text);
  } catch {
    // Not kept: the next look asks again.
  }
}

/**
 * Loads a preview: the kept one if there is one, otherwise from the server.
 *
 * @param request   The settings and question type.
 * @param fetchImpl fetch (tests replace it).
 * @returns The text, or a failure.
 * Called from: AnswerPreferencesDialog.tsx; tests
 */
export async function loadPreview(
  request: AnswerPreviewRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewResult> {
  const key = previewKey(request);
  const kept = readKept(key);
  if (kept) return { ok: true, text: kept };
  try {
    const response = await fetchImpl('/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) return { ok: false };
    const { text } = (await response.json()) as AnswerPreviewResponse;
    keep(key, text);
    return { ok: true, text };
  } catch {
    return { ok: false };
  }
}
