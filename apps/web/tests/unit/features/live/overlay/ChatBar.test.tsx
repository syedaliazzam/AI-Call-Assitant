/**
 * Tests for apps/web/src/features/live/overlay/ChatBar.tsx (ADR-0122): the overlay's chat bar has a text box
 * "Enter a message…" that never takes the keyboard by itself (no autofocus), Send with its Enter key-cap (muted
 * until something is typed), × to close, and no Screenshot button (the screenshot shortcuts do that). Typing,
 * Enter and Escape are covered in tests/integration/live.spec.ts (Node has no DOM events here).
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({
  getPlatform: () => ({ hotkeyModifier: () => 'Ctrl' }),
  isMacComputer: () => false,
}));
const { ChatBar, CHAT_MAX_CHARS } = await import('@/features/live/overlay/ChatBar');

/**
 * The chat bar as HTML.
 *
 * @param disabled True once the call has ended.
 * @returns The markup.
 */
function chatBar(disabled = false): string {
  return renderToString(
    <ChatBar onCommand={() => undefined} onClose={() => undefined} disabled={disabled} />,
  );
}

describe('ChatBar (ADR-0122)', () => {
  it('has the box "Enter a message…", Send with Enter and ×, as a group named Chat', () => {
    const html = chatBar();
    expect(html).toContain('role="group" aria-label="Chat"');
    expect(html).toContain('placeholder="Enter a message…"');
    expect(html).toContain('aria-label="Type a question"');
    // Send, then its Enter key-cap.
    expect(html).toMatch(/>Send <span[^>]*><kbd/);
    expect(html).toContain('aria-label="Close chat"');
    expect(html).toContain(`maxLength="${CHAT_MAX_CHARS}"`);
  });

  it('never takes the keyboard by itself (no autofocus)', () => {
    const html = chatBar();
    expect(html.toLowerCase()).not.toContain('autofocus');
  });

  it('has no Screenshot button (the screenshot shortcuts still work)', () => {
    const html = chatBar();
    expect(html).not.toMatch(/screenshot/i);
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it('keeps Send muted until something is typed, and gives the keyboard back after Send and ×', () => {
    const html = chatBar();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-releases-focus=""[^>]*>Send/);
    expect(html).toMatch(/<button[^>]*aria-label="Close chat"[^>]*data-releases-focus=""/);
  });

  it('cannot send once the call has ended', () => {
    expect(chatBar(true)).toMatch(/<input[^>]*disabled=""/);
  });
});
