/**
 * Tests for apps/web/src/core/auth/messages.ts: the sign-in messages (one message for a wrong email or
 * password, so the form never reveals which emails have accounts) and the sign-in form's own field
 * checks (ADR-0071).
 */
import { describe, expect, it } from 'vitest';
import { messageFor, signInFieldErrors } from '@/core/auth/messages';

describe('messageFor', () => {
  it('gives a wrong email and a wrong password the same message', () => {
    expect(messageFor('INVALID_EMAIL_OR_PASSWORD')).toBe('Email or password is incorrect.');
  });

  it('says when the account is disabled, and falls back for anything else', () => {
    expect(messageFor('BANNED_USER')).toMatch(/disabled/);
    expect(messageFor(undefined)).toBe('Sign-in failed. Please try again.');
  });
});

describe('signInFieldErrors', () => {
  it('asks for both fields when they are empty', () => {
    expect(signInFieldErrors('', '')).toEqual({
      email: 'Enter your email.',
      password: 'Enter your password.',
    });
  });

  it('treats an email of spaces as empty', () => {
    expect(signInFieldErrors('   ', 'secret').email).toBe('Enter your email.');
  });

  it('catches an email without an @ or a dot after it', () => {
    expect(signInFieldErrors('dana.example.com', 'secret').email).toBe(
      'Enter a valid email address.',
    );
    expect(signInFieldErrors('dana@example', 'secret').email).toBe('Enter a valid email address.');
  });

  it('accepts a normal email with spaces around it, and any non-empty password', () => {
    expect(signInFieldErrors('  dana@example.com ', ' ')).toEqual({});
  });
});
