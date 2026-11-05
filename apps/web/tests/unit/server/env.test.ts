/**
 * Tests for apps/web/src/server/env.ts:
 * getAuthEnv() validates the sign-in variables, names missing ones without printing values,
 * and falls back to https://VERCEL_URL on previews; getClaudeEnv() is separate, so sign-in
 * works before the Claude key exists.
 */
import { describe, expect, it } from 'vitest';
import { getAuthEnv, getClaudeEnv, getServerEnv } from '@/server/env';

/** A complete, valid set of sign-in variables (fake values). */
const AUTH_VARS = {
  DATABASE_URL: 'postgresql://user:pass@example.neon.tech/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
};

/** A complete set of Claude variables (fake values). */
const CLAUDE_VARS = {
  ANTHROPIC_API_KEY: 'test-key',
  KITE_MODEL_FAST: 'claude-haiku-5-5',
  KITE_MODEL_SMART: 'claude-sonnet-5-5',
};

describe('getAuthEnv', () => {
  it('returns the validated settings', () => {
    const env = getAuthEnv(AUTH_VARS);
    expect(env.databaseUrl).toBe(AUTH_VARS.DATABASE_URL);
    expect(env.secret).toBe(AUTH_VARS.BETTER_AUTH_SECRET);
    expect(env.baseUrl).toBe('http://localhost:3000');
    expect(env.trustedOrigins).toEqual(['http://localhost:3000']);
  });

  it('also trusts the addresses in KITE_TRUSTED_ORIGINS, each once', () => {
    const env = getAuthEnv({
      ...AUTH_VARS,
      BETTER_AUTH_URL: 'https://call.example.com',
      KITE_TRUSTED_ORIGINS: ' https://call.example.com , https://old.example.app/ ',
      VERCEL_URL: 'kite-abc123.vercel.app',
    });
    expect(env.baseUrl).toBe('https://call.example.com');
    expect(env.trustedOrigins).toEqual([
      'https://call.example.com',
      'https://old.example.app',
      'https://kite-abc123.vercel.app',
    ]);
  });

  it('adds nothing when KITE_TRUSTED_ORIGINS is empty', () => {
    const env = getAuthEnv({
      ...AUTH_VARS,
      BETTER_AUTH_URL: 'https://call.example.com',
      KITE_TRUSTED_ORIGINS: ' , ',
    });
    expect(env.trustedOrigins).toEqual(['https://call.example.com']);
  });

  it.each(['old.example.app', 'http://old.example.app', 'not a url'])(
    'refuses %s in KITE_TRUSTED_ORIGINS, naming the variable and not the value',
    (entry) => {
      const read = () =>
        getAuthEnv({
          ...AUTH_VARS,
          BETTER_AUTH_URL: 'https://call.example.com',
          KITE_TRUSTED_ORIGINS: entry,
        });
      expect(read).toThrow('KITE_TRUSTED_ORIGINS');
      expect(read).not.toThrow(entry);
    },
  );

  it('removes a trailing slash from BETTER_AUTH_URL', () => {
    expect(getAuthEnv({ ...AUTH_VARS, BETTER_AUTH_URL: 'https://kite.vercel.app/' }).baseUrl).toBe(
      'https://kite.vercel.app',
    );
  });

  it('names every missing variable', () => {
    expect(() => getAuthEnv({})).toThrow(
      /DATABASE_URL \(missing\).*BETTER_AUTH_SECRET \(missing\)/,
    );
  });

  it('treats empty values (NAME= lines) as missing', () => {
    expect(() => getAuthEnv({ ...AUTH_VARS, DATABASE_URL: '' })).toThrow(
      /DATABASE_URL \(missing\)/,
    );
  });

  it('rejects a short secret without printing it', () => {
    const run = () => getAuthEnv({ ...AUTH_VARS, BETTER_AUTH_SECRET: 'short-secret' });
    expect(run).toThrow(/BETTER_AUTH_SECRET \(must be at least 32 characters\)/);
    expect(run).not.toThrow(/short-secret/);
  });

  it('uses https://VERCEL_URL on previews and trusts the branch URL too', () => {
    const env = getAuthEnv({
      DATABASE_URL: AUTH_VARS.DATABASE_URL,
      BETTER_AUTH_SECRET: AUTH_VARS.BETTER_AUTH_SECRET,
      VERCEL_URL: 'kite-abc123.vercel.app',
      VERCEL_BRANCH_URL: 'kite-git-day-01.vercel.app',
    });
    expect(env.baseUrl).toBe('https://kite-abc123.vercel.app');
    expect(env.trustedOrigins).toEqual([
      'https://kite-abc123.vercel.app',
      'https://kite-git-day-01.vercel.app',
    ]);
  });

  it('fails clearly when neither BETTER_AUTH_URL nor VERCEL_URL is set', () => {
    const { BETTER_AUTH_URL: _unused, ...withoutUrl } = AUTH_VARS;
    expect(() => getAuthEnv(withoutUrl)).toThrow(/BETTER_AUTH_URL \(missing/);
  });

  it('does not require the Claude variables', () => {
    expect(() => getAuthEnv(AUTH_VARS)).not.toThrow();
  });
});

describe('getClaudeEnv', () => {
  it('returns the Claude settings', () => {
    expect(getClaudeEnv(CLAUDE_VARS)).toEqual({
      apiKey: 'test-key',
      modelFast: 'claude-haiku-5-5',
      modelSmart: 'claude-sonnet-5-5',
    });
  });

  it('names the missing Claude variables', () => {
    expect(() => getClaudeEnv({})).toThrow(/ANTHROPIC_API_KEY \(missing\)/);
  });
});

describe('getServerEnv', () => {
  it('needs both groups of variables', () => {
    expect(() => getServerEnv(AUTH_VARS)).toThrow(/ANTHROPIC_API_KEY/);
    expect(getServerEnv({ ...AUTH_VARS, ...CLAUDE_VARS }).claude.modelFast).toBe(
      'claude-haiku-5-5',
    );
  });
});
