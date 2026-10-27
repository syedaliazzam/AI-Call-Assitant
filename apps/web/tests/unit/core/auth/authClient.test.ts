/**
 * Tests for apps/web/src/core/auth/authClient.ts:
 * the module exposes the sign-in, sign-out and session functions the auth features use.
 */
import { describe, expect, it } from 'vitest';
import { authClient, signIn, signOut, useSession } from '@/core/auth/authClient';

describe('authClient', () => {
  it('exposes email sign-in', () => {
    expect(typeof signIn.email).toBe('function');
  });

  it('exposes sign-out and the session hook', () => {
    expect(typeof signOut).toBe('function');
    expect(typeof useSession).toBe('function');
  });

  it('includes the admin plugin endpoints', () => {
    expect(typeof authClient.admin.listUsers).toBe('function');
  });
});
