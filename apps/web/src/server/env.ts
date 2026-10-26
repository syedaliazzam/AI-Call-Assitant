/**
 * File: apps/web/src/server/env.ts
 * Purpose: Reads and validates the server's environment variables, failing with a clear message
 *          that names any missing or invalid variable. Separate getters let each feature check
 *          only what it needs (sign-in works before the Claude key exists).
 * Used by: src/server/db.ts, src/server/auth.ts, src/server/claude.ts (Stage 3)
 * Depends on: zod
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.1 (environment variables)
 */
import 'server-only';
import { z } from 'zod';

/**
 * A set of environment variables (name → value). process.env fits this type; tests pass plain
 * objects. NodeJS.ProcessEnv is not used because Next.js's types make NODE_ENV required on it.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Variables needed for the accounts database and sign-in. */
const authEnvSchema = z.object({
  /** Neon Postgres connection string. */
  DATABASE_URL: z.url(),
  /** Secret used to sign session cookies; Better Auth recommends at least 32 characters. */
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Public app address; optional because preview deployments fall back to VERCEL_URL. */
  BETTER_AUTH_URL: z.url().optional(),
  /** Set by Vercel on every deployment: the deployment's own host name (no https://). */
  VERCEL_URL: z.string().min(1).optional(),
  /** Set by Vercel on preview deployments: the branch's stable host name (no https://). */
  VERCEL_BRANCH_URL: z.string().min(1).optional(),
});

/** Variables needed for calling Claude (Stage 3). */
const claudeEnvSchema = z.object({
  /** Claude API key. Never logged or sent to the browser. */
  ANTHROPIC_API_KEY: z.string().min(1),
  /** Model name for live answers, for example 'claude-haiku-5-5'. */
  KITE_MODEL_FAST: z.string().min(1),
  /** Model name for notes, for example 'claude-sonnet-5-5'. */
  KITE_MODEL_SMART: z.string().min(1),
});

/** Validated sign-in settings, with the app's public address already worked out. */
export interface AuthEnv {
  /** Neon Postgres connection string. */
  databaseUrl: string;
  /** Cookie-signing secret. */
  secret: string;
  /** Public address of the app, for example 'http://localhost:3000' (no trailing slash). */
  baseUrl: string;
  /** Every address the app may be opened from (used as Better Auth trustedOrigins). */
  trustedOrigins: string[];
}

/** Validated Claude settings. */
export interface ClaudeEnv {
  /** Claude API key. */
  apiKey: string;
  /** Model name for live answers. */
  modelFast: string;
  /** Model name for notes. */
  modelSmart: string;
}

/** Everything the server needs: sign-in plus Claude. */
export interface ServerEnv {
  /** Sign-in settings. */
  auth: AuthEnv;
  /** Claude settings. */
  claude: ClaudeEnv;
}

/**
 * Validates `source` against a schema and throws one readable error listing every problem.
 * Only variable names and zod's reason are included, never the values (they may be secrets).
 *
 * @param schema The zod schema to check against.
 * @param source The variables to check (normally process.env).
 * @returns The parsed variables.
 * @throws Error('Missing or invalid environment variables: NAME (reason), ...').
 * Called from: getAuthEnv(), getClaudeEnv()
 */
function parseEnv<T extends z.ZodType>(schema: T, source: EnvSource): z.infer<T> {
  // Treat empty strings as missing: `vercel env pull` and .env.example both write NAME= lines.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.');
      const reason = issue.code === 'invalid_type' ? 'missing' : issue.message;
      return `${name} (${reason})`;
    });
    throw new Error(`Missing or invalid environment variables: ${problems.join(', ')}`);
  }
  return result.data;
}

/**
 * Reads the sign-in settings.
 * The public address is BETTER_AUTH_URL when set (local development and production). On Vercel
 * preview deployments it is not set, so the deployment's own address (https://VERCEL_URL) is used.
 *
 * @param source Variables to read; defaults to process.env (tests pass their own).
 * @returns The validated AuthEnv.
 * @throws Error naming each missing or invalid variable, or saying no public address is known.
 * Called from: src/server/db.ts, src/server/auth.ts
 */
export function getAuthEnv(source: EnvSource = process.env): AuthEnv {
  const env = parseEnv(authEnvSchema, source);
  const vercelUrl = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined;
  const branchUrl = env.VERCEL_BRANCH_URL ? `https://${env.VERCEL_BRANCH_URL}` : undefined;
  const baseUrl = (env.BETTER_AUTH_URL ?? vercelUrl)?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(
      'Missing or invalid environment variables: BETTER_AUTH_URL (missing, and VERCEL_URL is not set either)',
    );
  }
  // A preview can be opened from its deployment URL or its branch URL; both must be trusted,
  // or Better Auth rejects the sign-in form as a cross-site request.
  const trustedOrigins = [...new Set([baseUrl, vercelUrl, branchUrl].filter((url) => !!url))];
  return {
    databaseUrl: env.DATABASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    baseUrl,
    trustedOrigins: trustedOrigins as string[],
  };
}

/**
 * Reads the Claude settings.
 *
 * @param source Variables to read; defaults to process.env (tests pass their own).
 * @returns The validated ClaudeEnv.
 * @throws Error naming each missing variable.
 * Called from: src/server/claude.ts (Stage 3)
 */
export function getClaudeEnv(source: EnvSource = process.env): ClaudeEnv {
  const env = parseEnv(claudeEnvSchema, source);
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    modelFast: env.KITE_MODEL_FAST,
    modelSmart: env.KITE_MODEL_SMART,
  };
}

/**
 * Reads every server setting at once (sign-in and Claude).
 *
 * @param source Variables to read; defaults to process.env.
 * @returns The validated ServerEnv.
 * @throws Error naming each missing or invalid variable.
 * Called from: places that need the complete configuration (for example a start-up check).
 */
export function getServerEnv(source: EnvSource = process.env): ServerEnv {
  return { auth: getAuthEnv(source), claude: getClaudeEnv(source) };
}
