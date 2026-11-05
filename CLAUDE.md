# CLAUDE.md — Kite (AI Call Assistant)

Read this file at the start of every session. It is the rulebook for this repository.

## What Kite is

Kite is a small internal call assistant for our team. During a call it:

- listens to both sides ("You" = microphone, "Them" = the other person);
- shows a live transcript;
- when the user presses a key, streams a short answer from the **Claude API** using the session's details and documents.

It works as a **desktop app (macOS and Windows)** and **in the browser (Chrome or Edge)**.

## The documents we build from (read before coding)

| What | File |
|---|---|
| Architecture + 7-day plan (**single source of truth**) | `docs/architecture/kite-architecture-v3.1.md` |
| Why the app has this shape | `docs/decisions/ADR-0021-web-app-plus-thin-desktop-shell.md` |
| Sign-in design (admin-created email + password accounts) | `docs/decisions/ADR-0022-email-password-accounts-with-admin-page.md` |
| Speech-to-text model choice (decided on Day 1) | `docs/decisions/ADR-0020-stt-model.md` |
| Today's work instructions | `docs/implementation/day-NN-*.md` |
| Measured results (only real measurements) | `docs/testing/benchmark-results.md` |
| UI theme (for later stages; not implemented yet) | `docs/design/kite-ui-theme.md` |

If code and these documents disagree, stop and ask. Do not silently change the architecture. Architecture changes need a new ADR (copy `docs/decisions/TEMPLATE.md`).

## Shape of the system

- **`apps/web`:** THE application. A Next.js app deployed to Vercel. It has all screens, browser logic and the server routes:
  - `/api/auth/*` (Better Auth);
  - `/api/answer` and `/api/notes`, which hold the Claude key and stream Claude replies.
- **`apps/desktop`:** a thin Electron app that opens the deployed web app and adds native features through `window.kiteDesktop`.
- **`packages/shared`:** TypeScript types used by both apps: API request/response, desktop bridge, hotkeys.
- **Accounts database:** Neon Postgres (via Vercel), for user accounts and sign-in sessions **only**, and per-user daily request counts (ADR-0036; counts, never text).
- **Call data** (sessions, documents, transcripts, answers) is stored on the user's device in IndexedDB. Audio never leaves the device.
- **Models:** `claude-haiku-5-5` (fast, live answers) and `claude-sonnet-5-5` (smart, notes). Model names come from environment variables.

## Folder rules

| Folder | May contain | Must NOT contain |
|---|---|---|
| `apps/web/app/` | Routes only: pages, layouts, API route files. Keep them thin; they call `src/`. | Business logic |
| `apps/web/src/server/` | Server-only code: database, auth, Claude client, validation. Start each file with `import 'server-only'`. | Anything imported by client components |
| `apps/web/src/core/` | Browser logic without React (audio, speech-to-text, answer client, storage) | React components |
| `apps/web/src/platform/` | The **only** place desktop and browser behave differently | — |
| `apps/web/src/features/<name>/` | React components for one feature | Direct `fetch`, IndexedDB or media calls (use `core/` and `platform/`) |
| `apps/web/src/ui/` | Small shared UI pieces (Button, Input, Sidebar) | Feature logic |
| `apps/desktop/src/` | Electron main process, preload, security | Business logic (it lives in the web app) |
| `packages/shared/src/` | Types and constants shared by web and desktop | Runtime dependencies on Node or the browser |

## Commenting standard (mandatory, every file)

The team must be able to understand every file by reading its comments.

**1. File header.** Every file starts with a block comment:

```ts
/**
 * File: apps/web/src/server/users.ts
 * Purpose: Create and manage Kite user accounts (admin actions) and mark password changes.
 * Used by: app/(app)/admin/users/actions.ts, app/change-password/actions.ts
 * Depends on: server/auth.ts (Better Auth instance), server/db.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (ADR-0022)
 */
```

**2. Every function, React component, class and exported constant** gets a JSDoc block. It says what it does, what each parameter means, what it returns, what errors it throws, and where it is called from:

```ts
/**
 * Creates a new user account with a temporary password (admin only).
 * The user must change this password at first sign-in (mustChangePassword = true).
 *
 * @param input.name  Display name shown in the app.
 * @param input.email Login email; stored lower-case.
 * @param input.role  'admin' or 'user'.
 * @returns The created user's id and the one-time temporary password to share with the person.
 * @throws Error('EMAIL_TAKEN') if an account with this email already exists.
 * Called from: createUserAction() in app/(app)/admin/users/actions.ts
 */
export async function createUserAccount(input: NewUserInput): Promise<CreatedUser> { … }
```

**3. Inline comments** explain *why* for any non-obvious line: security choices, workarounds, timing, caching.

**4. Database tables and columns** each get a comment explaining what is stored and why.

**5. Types and interfaces:** comment every field.

**6. Tests** start with a comment saying which file and behaviour they cover.

**7. Plain language.** Write comments a new team member can follow. No jokes, no "TODO" without an explanation and the day it will be done (e.g. `// Day 3: replace with IndexedDB storage`).

## Coding rules

- TypeScript `strict` everywhere. No `any` unless commented why. Lint and format must pass.
- **Secrets never go in code, commits, logs or chat.** They come from environment variables. `.env.example` lists names only. To add a secret, the developer runs `vercel env add NAME`, then `vercel env pull apps/web/.env.local`.
- Never log transcript, document, answer or screenshot text, or passwords. Log ids, timings and token counts only.
- All Claude calls go through `apps/web/src/server/claude.ts`.
- All desktop/browser differences live in `apps/web/src/platform/`. No `if (desktop)` anywhere else.
- Desktop security: load only the Kite addresses (ADR-0046); `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; the preload exposes only `window.kiteDesktop`.
- Keep the mic ("You") and other-side ("Them") audio as separate channels.
- Screen-share protection uses `setContentProtection` only. Never hide from the taskbar, Dock or process lists, and never try to evade monitoring or proctoring tools.
- Add a dependency only with a reason (state it in the stage summary). Prefer the latest stable versions.
- If an official library API differs from our docs (Next.js, Better Auth, Electron, sherpa-onnx, Anthropic SDK), follow the official docs and mention the difference in the stage summary.

## Claude key and spend

- **One key:** `ANTHROPIC_API_KEY`, the same in Vercel (Production, Preview, Development) and in `apps/web/.env.local` (from `vercel env pull`). The deployed app, `pnpm dev`, the verify scripts and the evaluations all use it.
- **One spend limit** in the Claude Console, about $20 a month for the whole team. Tests and evaluations spend from the same budget as production. So:
  - before any paid run (evaluation, verify script, real-API check), tell the developer the estimated request count and cost, and run it only after they agree;
  - follow "Evaluation cost" under Testing rules.
- The scripts refuse to run without a key (`scripts/lib/require-key.ts`). There is no other key check.
- Never print or log a key.

## Testing rules

- Every module in `src/server`, `src/core` and `src/platform` gets unit tests (Vitest) in `apps/web/tests/unit/<same path>`.
- Tests never call the real Claude API (mock the SDK). They never need real secrets.
- Before every commit: `pnpm lint && pnpm typecheck && pnpm test` must pass.
- Record only **measured** numbers in `docs/testing/benchmark-results.md`, with date, machine and browser.
- **Evaluation cost:** re-run only the scenario groups a change touches (`--only=answers`, `--only=screenshots`, `--only=notes`). Run the full suite (`pnpm --filter web eval:all`) **at release only when the live-answer prompts or answer pipeline changed**; otherwise run only the groups the change touches. The grader stays Sonnet (baselines stay comparable). Each run prints its estimated number of Claude requests before sending anything; `--dry-run` prints only that. **Before any paid run** (eval, verify script, real-API check), tell the developer the estimated request count and cost, and run it only after they agree. Groups and gates: `docs/testing/answer-eval.md`.

## Working rhythm with Claude Code

- Work happens in **stages** defined in `docs/implementation/day-NN-*.md`.
- After each stage:
  1. Run the checks.
  2. Commit with a Conventional Commit message (`feat(web): …`, `chore: …`, `test: …`, `docs: …`).
  3. Print a short summary: files created or changed with a one-line purpose each, commands for the developer to try, and anything needing the developer's action.
  4. **Stop and wait for "continue".**
- Work on a branch per day (`day-01-setup`, `day-02-audio`, …) and open a pull request into `main` at the end of the day.
- When something in the architecture changes, update `docs/architecture/kite-architecture-v3.1.md` (bump the version) and add an ADR in the same pull request.
