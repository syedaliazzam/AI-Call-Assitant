/**
 * Tests for apps/web/src/features/auth/LoginForm.tsx, as the server renders it (before React takes over
 * the page): the form posts (a native submit can never put the email and password in the address), and
 * the Sign in button is disabled until the page is hydrated, so an early press does nothing.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/core/auth/authClient', () => ({ signIn: { email: vi.fn() } }));
vi.mock('@/platform', () => ({ getPlatform: () => ({ hasHomePanel: () => false }) }));
const { LoginForm } = await import('@/features/auth/LoginForm');

describe('LoginForm before hydration', () => {
  const html = renderToString(<LoginForm />);

  it('posts, never a GET with the password in the address', () => {
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*method="get"/i);
  });

  it('keeps Sign in disabled until the page is hydrated', () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>[^<]*Sign in/);
  });
});
