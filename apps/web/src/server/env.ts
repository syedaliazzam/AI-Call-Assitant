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
  /**
   * Other addresses this deployment is also opened from, comma-separated (ADR-0046): production
   * has the custom domain and the vercel.app address that installed desktop apps are locked to.
   */
  KITE_TRUSTED_ORIGINS: z.string().optional(),
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

/**
 * ADR-0095: the model the "Fastest (Groq)" choice uses when GROQ_MODEL is not set. Checked against
 * Groq's models endpoint on 17 Nov 2026 (active, 131,072-token context).
 */
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

/** Variables for the third answer model, Groq (ADR-0095). Both optional: without a key Groq is off. */
const groqEnvSchema = z.object({
  /** Groq API key. Server-only; never logged or sent to the browser. */
  GROQ_API_KEY: z.string().min(1).optional(),
  /** Groq model id, for example 'openai/gpt-oss-120b' (default DEFAULT_GROQ_MODEL). */
  GROQ_MODEL: z.string().min(1).optional(),
});

/** Validated Groq settings (ADR-0095). */
export interface GroqEnv {
  /** Groq API key. */
  apiKey: string;
  /** Groq model id. */
  model: string;
}

/**
 * ADR-0099: the models the Gemini and GPT choices use when their variables are not set. Each was checked on its
 * provider's models endpoint with our keys on 17 Nov 2026 (all four listed).
 */
export const DEFAULT_ANSWER_MODEL_IDS = {
  /** "Gemini 3.5 Flash Lite" (KITE_MODEL_GEMINI_LITE). */
  geminiLite: 'gemini-3.5-flash-lite',
  /** "Gemini 3.6 Flash" (KITE_MODEL_GEMINI_FLASH). */
  geminiFlash: 'gemini-3.6-flash',
  /** "GPT-5.6 Luna" (KITE_MODEL_OPENAI_FAST). */
  openaiFast: 'gpt-5.6-luna',
  /** "GPT-5.6 Terra" (KITE_MODEL_OPENAI_SMART). */
  openaiSmart: 'gpt-5.6-terra',
} as const;

/** ADR-0099: Google's Gemini settings. All optional: without a key Gemini is off. */
const geminiEnvSchema = z.object({
  /** Gemini API key. Server-only; never logged or sent to the browser. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /** Model id for "Gemini 3.5 Flash Lite" (default DEFAULT_ANSWER_MODEL_IDS.geminiLite). */
  KITE_MODEL_GEMINI_LITE: z.string().min(1).optional(),
  /** Model id for "Gemini 3.6 Flash" (default DEFAULT_ANSWER_MODEL_IDS.geminiFlash). */
  KITE_MODEL_GEMINI_FLASH: z.string().min(1).optional(),
});

/** ADR-0099: OpenAI's settings. All optional: without a key the GPT models are off. */
const openaiEnvSchema = z.object({
  /** OpenAI API key. Server-only; never logged or sent to the browser. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Model id for "GPT-5.6 Luna" (default DEFAULT_ANSWER_MODEL_IDS.openaiFast). */
  KITE_MODEL_OPENAI_FAST: z.string().min(1).optional(),
  /** Model id for "GPT-5.6 Terra" (default DEFAULT_ANSWER_MODEL_IDS.openaiSmart). */
  KITE_MODEL_OPENAI_SMART: z.string().min(1).optional(),
});

/** ADR-0099: validated settings for one third-party provider with two models. */
export interface ProviderEnv {
  /** The provider's API key. */
  apiKey: string;
  /** The quicker model's id (Gemini 3.5 Flash Lite, GPT-5.6 Luna). */
  modelFast: string;
  /** The smarter model's id (Gemini 3.6 Flash, GPT-5.6 Terra). */
  modelSmart: string;
}

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
 * Reads the list of extra trusted addresses. A wrong entry stops the app rather than being dropped,
 * because a dropped address would silently break sign-in for everyone who uses it.
 *
 * @param list The KITE_TRUSTED_ORIGINS value, if set.
 * @returns Each address's origin.
 * @throws Error naming the variable (never its value) when an entry is not an https address.
 * Called from: getAuthEnv()
 */
function extraTrustedOrigins(list: string | undefined): string[] {
  const entries = (list ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return entries.map((entry) => {
    const url = URL.canParse(entry) ? new URL(entry) : null;
    if (url?.protocol !== 'https:') {
      throw new Error(
        'Missing or invalid environment variables: KITE_TRUSTED_ORIGINS (each entry must be an https address)',
      );
    }
    return url.origin;
  });
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
  // Production also lists the addresses in KITE_TRUSTED_ORIGINS: without them, changing
  // BETTER_AUTH_URL would refuse sign-in on the address installed desktop apps load.
  const trustedOrigins = [
    ...new Set(
      [baseUrl, ...extraTrustedOrigins(env.KITE_TRUSTED_ORIGINS), vercelUrl, branchUrl].filter(
        (url) => !!url,
      ),
    ),
  ];
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
 * Reads the Groq settings (ADR-0095). Groq is optional: with no key it is simply not offered, and a
 * session set to it answers with Claude Haiku.
 *
 * @param source Variables to read; defaults to process.env (tests pass their own).
 * @returns The GroqEnv, or null when GROQ_API_KEY is not set.
 * Called from: app/api/answer/route.ts, src/server/modelAccess.ts
 */
export function getGroqEnv(source: EnvSource = process.env): GroqEnv | null {
  const env = parseEnv(groqEnvSchema, source);
  if (!env.GROQ_API_KEY) return null;
  return { apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL };
}

/**
 * Reads Google's Gemini settings (ADR-0099). Optional: with no key the Gemini models are not offered, and a
 * session set to one answers with Claude Haiku.
 *
 * @param source Variables to read; defaults to process.env (tests pass their own).
 * @returns The ProviderEnv, or null when GEMINI_API_KEY is not set.
 * Called from: app/api/answer/route.ts, src/server/modelAccess.ts, app/(app)/admin/usage/page.tsx
 */
export function getGeminiEnv(source: EnvSource = process.env): ProviderEnv | null {
  const env = parseEnv(geminiEnvSchema, source);
  if (!env.GEMINI_API_KEY) return null;
  return {
    apiKey: env.GEMINI_API_KEY,
    modelFast: env.KITE_MODEL_GEMINI_LITE ?? DEFAULT_ANSWER_MODEL_IDS.geminiLite,
    modelSmart: env.KITE_MODEL_GEMINI_FLASH ?? DEFAULT_ANSWER_MODEL_IDS.geminiFlash,
  };
}

/**
 * Reads OpenAI's settings (ADR-0099). Optional: with no key the GPT models are not offered, and a session set
 * to one answers with Claude Haiku.
 *
 * @param source Variables to read; defaults to process.env (tests pass their own).
 * @returns The ProviderEnv, or null when OPENAI_API_KEY is not set.
 * Called from: app/api/answer/route.ts, src/server/modelAccess.ts, app/(app)/admin/usage/page.tsx
 */
export function getOpenAIEnv(source: EnvSource = process.env): ProviderEnv | null {
  const env = parseEnv(openaiEnvSchema, source);
  if (!env.OPENAI_API_KEY) return null;
  return {
    apiKey: env.OPENAI_API_KEY,
    modelFast: env.KITE_MODEL_OPENAI_FAST ?? DEFAULT_ANSWER_MODEL_IDS.openaiFast,
    modelSmart: env.KITE_MODEL_OPENAI_SMART ?? DEFAULT_ANSWER_MODEL_IDS.openaiSmart,
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
