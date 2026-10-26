# Day 1 — Setup (instructions for Claude Code)

**Goal:** a working skeleton that proves the risky foundations, with no product features yet. By the end of Day 1:

1. The web app runs locally and on Vercel (`*.vercel.app`) behind **email + password sign-in**. The admin creates users, and new users must change their password.
2. A test page streams a **Claude** reply and shows timings and prompt-cache use.
3. The **desktop app** (Electron) opens the deployed web app, and you can sign in inside it.
4. A test page runs **speech-to-text in the browser** (sherpa-onnx WebAssembly), and we record measured numbers in ADR-0020.
5. **CI** runs lint, typecheck and tests on every pull request.

**Read first:** `CLAUDE.md`, then `docs/architecture/kite-architecture-v3.1.md` §3 (architecture), §7 (components), §8.2 (sign-in), §9 (folders and code rules), §10.1 (Vercel), §11 (testing), §12 (Day 1), and ADR-0020, 0021 and 0022.

**Branch:** `day-01-setup`. Open a pull request into `main` at the end.

**After every stage:**

1. Run `pnpm lint && pnpm typecheck && pnpm test`.
2. Commit.
3. Print the stage summary (files + one-line purpose, commands to try, actions needed from the developer).
4. **STOP and wait for "continue".**

---

## Stage 1 — Monorepo skeleton and tooling

**Create:**

| File | Contents |
|---|---|
| `package.json` (root) | Workspace scripts: `dev` (web), `build`, `lint`, `typecheck`, `test`, `format`; `engines.node >= 20`; `packageManager` pnpm |
| `pnpm-workspace.yaml` | `apps/*`, `packages/*` |
| `tsconfig.base.json` | Strict TypeScript settings shared by all packages |
| `eslint.config.mjs`, `.prettierrc`, `.editorconfig` | One lint and format style for the whole repo |
| `.gitignore` | `node_modules`, `.next`, `dist`, `out`, `.vercel`, `.env*` (but keep `.env.example`), `apps/web/public/models/**` (model files are downloaded, not committed), `coverage`, OS files |
| `README.md` | What Kite is (2 lines), prerequisites, how to install, run, test, deploy |
| `packages/shared/package.json` | Name `@kite/shared`; TypeScript source only |
| `packages/shared/src/api.ts` | `AnswerMode` (`'hello' \| 'warm' \| 'answer' \| 'chat' \| 'screenshot'`; only `hello` is used on Day 1), `AnswerRequest`, `AnswerEvent` (`delta`, `done` with usage and timings, `error` with code and message). Every field commented. |
| `packages/shared/src/desktop-bridge.ts` | `KiteDesktopApi` (Day 1: `version: string`, `os: 'mac' \| 'windows' \| 'linux'`; later days add methods, listed in a comment) and the `window.kiteDesktop` global type |
| `packages/shared/src/hotkeys.ts` | `HotkeyAction` union (`answer`, `screenshot`, `clear`, `prev`, `next`) |
| `packages/shared/src/index.ts` | Re-exports |
| `apps/web` | Next.js (latest stable, App Router, TypeScript, Tailwind CSS), path alias `@/*` → `src/*`, Vitest set up |
| `apps/web/app/layout.tsx` | Root HTML frame, font, metadata ("Kite") |
| `apps/web/app/(app)/layout.tsx` | Signed-in frame with the sidebar (Day 1: no auth check yet; added in Stage 2) |
| `apps/web/app/(app)/page.tsx` | Dashboard route; renders `features/dashboard/Dashboard.tsx` |
| `apps/web/src/features/dashboard/Dashboard.tsx` | Empty state like ParakeetAI's "Call Sessions": title, subtitle, disabled "Create session" button with the note "Available on Day 3" |
| `apps/web/src/ui/Sidebar.tsx` | Kite logo/name; links: Call Sessions, Settings (disabled, Day 3), Admin (shown later for admins only), Dev tools (admins only, later); user box at the bottom (filled in Stage 2) |
| `apps/web/src/ui/Button.tsx`, `Input.tsx` | Small reusable components with variants; fully commented props |
| `apps/web/src/platform/types.ts` | The `Platform` interface exactly as in architecture §3.3, every method commented with what desktop and browser each do |
| `apps/web/src/platform/browser.ts` | `browserPlatform`: `kind: 'browser'`; `getMicStream()` works (getUserMedia); every other method throws `NotImplementedError` with a comment naming the day it arrives |
| `apps/web/src/platform/desktop.ts` | `desktopPlatform`: reads `window.kiteDesktop`; Day 1 only reports version and os; other methods throw `NotImplementedError` with the day |
| `apps/web/src/platform/index.ts` | `getPlatform()`: returns the desktop platform when `window.kiteDesktop` exists, otherwise the browser one; `isDesktop()` helper |
| `apps/web/src/platform/errors.ts` | `NotImplementedError` class |
| `apps/web/tests/unit/platform/index.test.ts` | Tests: picks browser without `window.kiteDesktop`, desktop with it |
| `apps/desktop/package.json` | Placeholder (name `@kite/desktop`); built in Stage 5 |

**Check:** `pnpm install`, `pnpm dev` → http://localhost:3000 shows the sidebar and the empty dashboard. `pnpm lint && pnpm typecheck && pnpm test` pass.

---

## Stage 2 — Accounts database, sign-in and admin page

**Developer actions (Claude Code explains each, step by step, and waits):**

1. `npm i -g vercel` then `vercel login` (if not done).
2. From the repo root: `vercel link`. Create a new project named `kite`. When asked "In which directory is your code located?", answer `apps/web`.
3. In the Vercel dashboard → the `kite` project → **Storage** → **Create Database** → **Neon** (Free plan) → connect it to the project for all environments. This adds `DATABASE_URL`.
4. Create the auth secret: `vercel env add BETTER_AUTH_SECRET` (all environments). The value is a random string; Claude Code gives a command to generate one locally, e.g. `npx @better-auth/cli secret` or `openssl rand -base64 32`.
5. `vercel env add BETTER_AUTH_URL` with value `http://localhost:3000` for **Development** only (production is set in Stage 4).
6. `vercel env pull apps/web/.env.local`

**Install (web):** `better-auth`, `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit` (dev), `zod`, `tsx` (dev).

**Create:**

| File | Contents |
|---|---|
| `apps/web/.env.example` | Variable names with comments, no values: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ANTHROPIC_API_KEY`, `KITE_MODEL_FAST`, `KITE_MODEL_SMART` |
| `apps/web/src/server/env.ts` | `getServerEnv()`: reads and validates variables with zod; clear error naming the missing variable; separate getters so Stage 2 does not require the Claude key yet (`getAuthEnv()`, `getClaudeEnv()`) |
| `apps/web/src/server/db.ts` | `db`: Drizzle client over Neon serverless (HTTP); comment on why serverless HTTP suits Vercel functions |
| `apps/web/src/server/schema.ts` | Better Auth tables (`user`, `session`, `account`, `verification`) generated with the Better Auth CLI for Drizzle, **plus** the admin-plugin fields (`role`, `banned`, `banReason`, `banExpires`, `impersonatedBy`) and our extra user field `mustChangePassword` (boolean, default true). Every table and column commented. |
| `apps/web/drizzle.config.ts` | Drizzle Kit config (schema path, `drizzle/` migrations folder, `DATABASE_URL`) |
| `apps/web/drizzle/` | Generated SQL migrations (committed) |
| `apps/web/src/server/auth.ts` | `auth = betterAuth({...})`: Drizzle adapter (pg); `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 }`; `user.additionalFields.mustChangePassword` (not settable by users); plugins `admin()` and `nextCookies()`; session expiry 30 days; `baseURL` from `BETTER_AUTH_URL`, falling back to `https://${VERCEL_URL}` on preview deployments; `trustedOrigins` for that URL. `getSession()` helper for server components. |
| `apps/web/app/api/auth/[...all]/route.ts` | Better Auth route handler (`toNextJsHandler(auth)`) |
| `apps/web/src/core/auth/authClient.ts` | Browser auth client (`createAuthClient` + `adminClient()`); exports `signIn`, `signOut`, `useSession` |
| `apps/web/src/server/guard.ts` | `decideRedirect(session, pathname)`: pure function returning `'/login'`, `'/change-password'`, `'/'` (non-admin on admin pages) or `null`. Unit tested. `requireUser()` and `requireAdmin()` helpers for server components and actions. |
| Route guard file (`middleware.ts` or `proxy.ts`, whichever the installed Next.js uses) | Fast cookie-presence check that sends signed-out visitors to `/login`; the full checks are in `(app)/layout.tsx` via `requireUser()` |
| `apps/web/app/login/page.tsx` + `src/features/auth/LoginForm.tsx` | Email + password form; error message on failure; no sign-up link |
| `apps/web/app/change-password/page.tsx` + `src/features/auth/ChangePasswordForm.tsx` + `app/change-password/actions.ts` | Current (temporary) password, new password, confirm. On success it calls Better Auth's change-password, then `markPasswordChanged(userId)` sets `mustChangePassword = false` and redirects to `/`. |
| `apps/web/app/(app)/layout.tsx` (update) | Calls `requireUser()`; passes the user to the sidebar (name, role, sign-out button) |
| `apps/web/src/server/users.ts` | Wrappers over the Better Auth admin API (call with request headers): `listUserAccounts()`, `createUserAccount({name, email, role})` (generates a temporary password, sets `mustChangePassword = true`, returns the password once), `resetUserPassword(userId)` (new temporary password + `mustChangePassword = true`), `setUserDisabled(userId, disabled)` (ban/unban; banning ends their sessions), `setUserRole(userId, role)`, `markPasswordChanged(userId)` |
| `apps/web/src/server/passwords.ts` | `generateTemporaryPassword()`: 14 characters, readable (no 0/O/1/l), crypto-random. Unit tested. |
| `apps/web/app/(app)/admin/layout.tsx` | Calls `requireAdmin()` |
| `apps/web/app/(app)/admin/users/page.tsx` | Admin users page; renders `features/admin/UsersTable.tsx` and `CreateUserForm.tsx` |
| `apps/web/app/(app)/admin/users/actions.ts` | Server actions: `createUserAction`, `resetPasswordAction`, `toggleDisabledAction`, `setRoleAction`. Each checks `requireAdmin()`, validates input with zod, calls `server/users.ts`, and returns a result object (never throws to the UI). |
| `apps/web/src/features/admin/UsersTable.tsx` | Table: name, email, role, status (active, disabled, must change password), created; row actions (reset password, disable/enable, make admin/user); shows a new temporary password once in a copyable box |
| `apps/web/src/features/admin/CreateUserForm.tsx` | Name, email, role; shows the generated temporary password once |
| `apps/web/scripts/create-admin.ts` + script `create-admin` in `apps/web/package.json` | Creates the **first** admin: `pnpm --filter web create-admin --email you@company.com --name "Your Name"`. Uses Better Auth's own mechanism (the admin docs' `create-admin` approach or its server API with its own password hashing; **never** write a plain or self-hashed password into the table). Prints the temporary password once. Refuses if the email already exists. |
| `apps/web/package.json` scripts | `db:generate`, `db:migrate` (Drizzle), `create-admin` |
| Tests | `tests/unit/server/guard.test.ts`, `tests/unit/server/passwords.test.ts`, `tests/unit/server/env.test.ts` |

**Check (locally):**

- [ ] `pnpm --filter web db:migrate` creates the tables in Neon.
- [ ] `pnpm --filter web create-admin …` prints a temporary password.
- [ ] Sign in → forced to `/change-password` → after changing, the dashboard appears.
- [ ] `/admin/users`: create a user, copy their temporary password, sign out, sign in as them → forced change → `/admin/users` redirects them away.
- [ ] Disable that user as admin → their next request is signed out.
- [ ] Tests pass.

---

## Stage 3 — Claude streaming test

**Developer actions:**

1. `vercel env add ANTHROPIC_API_KEY` (all environments). Paste the key **into the terminal prompt only**, never into chat or code.
2. `vercel env add KITE_MODEL_FAST` = `claude-haiku-5-5`, then `vercel env add KITE_MODEL_SMART` = `claude-sonnet-5-5` (all environments).
3. `vercel env pull apps/web/.env.local`

**Install (web):** `@anthropic-ai/sdk`.

**Create:**

| File | Contents |
|---|---|
| `apps/web/src/server/claude.ts` | `getClaude()`: one SDK client, key from `getClaudeEnv()`. `streamReply({ model, system, messages, maxTokens, signal })`: calls the Messages API with streaming; the system block is marked `cache_control: { type: 'ephemeral' }`; yields text deltas; on finish returns usage (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). No extended thinking. The comments explain prompt caching (identical prefix, 5-minute lifetime, 512-token minimum). |
| `apps/web/src/server/sse.ts` | `formatEvent(type, data)` and `toEventStream(source, onDone)`: turns the reply into a `text/event-stream` `ReadableStream` (`delta`, `done`, `error` events), flushing each chunk immediately (no buffering) |
| `apps/web/src/server/validate.ts` | zod schema for `AnswerRequest` (from `@kite/shared`) with size limits |
| `apps/web/src/server/prompts/hello.ts` | The Day 1 test prompt: a fixed ~1,000-token "sample session context" system block (so prompt caching can be verified; shorter prompts are not cached) plus the instruction "Reply in one short sentence" |
| `apps/web/app/api/answer/route.ts` | `POST`: requires a signed-in user (401 otherwise); validates the body (400); Day 1 supports `mode: 'hello'` only (others → 400 "not implemented yet: Day N"); streams via `streamReply` + `toEventStream`; the `done` event includes usage and server timings; logs only ids, timings and token counts. `export const runtime = 'nodejs'`. Comment on why streaming must not be buffered. |
| `apps/web/src/core/answer/answerClient.ts` | `streamAnswer(request, handlers)`: `fetch` with an `AbortController`; parses SSE incrementally; calls `onDelta`, `onDone`, `onError`; measures `msToFirstText` and `msTotal` with `performance.now()`; returns `{ cancel }` |
| `apps/web/app/(app)/dev/claude-test/page.tsx` + `src/features/dev/ClaudeTest.tsx` | Admin-only test page. "Ask Claude" button, streamed text, a Cancel button, and a results table: time to first word, total time, input/output tokens, cache write/read tokens. A note explains that the second click within 5 minutes should show cache-read tokens > 0. |
| `apps/web/app/(app)/dev/layout.tsx` | `requireAdmin()` (dev tools are admin-only) |
| Tests | `tests/unit/server/sse.test.ts` (event format, flushing); `tests/unit/core/answer/answerClient.test.ts` (parses chunked SSE across chunk boundaries, cancel aborts); `tests/unit/api/answer.route.test.ts` (SDK mocked: 401 without session, 400 bad body, streams deltas then done) |

**Check:**

- [ ] On `/dev/claude-test`, the reply streams word by word.
- [ ] The first click shows a cache write; the second click (within 5 minutes) shows cache read > 0.
- [ ] Record "time to first word" for 5 clicks (local) in `docs/testing/benchmark-results.md` as a first measurement (label it "local dev server").

---

## Stage 4 — Deploy with the Vercel CLI

**Create or update:**

| File | Contents |
|---|---|
| `apps/web/vercel.json` | `"regions": ["iad1"]` (US East, near the Claude API; comment why), plus any monorepo install settings needed for pnpm |
| `README.md` | "Deploy" section with the exact CLI commands |

**Developer actions (Claude Code explains each):**

1. `vercel deploy` → preview URL. Note it.
2. Set production `BETTER_AUTH_URL`: `vercel env add BETTER_AUTH_URL production` → `https://<project>.vercel.app`.
3. `vercel deploy --prod` → production URL `https://<project>.vercel.app`.
4. (Optional but recommended) Vercel dashboard → Project → Settings → Git → connect `syedaliazzam/AI-Call-Assitant`, so pushes and pull requests deploy automatically.

**Check:**

- [ ] On the production URL: sign in (the same Neon database, so the admin account works), `/admin/users` works, and `/dev/claude-test` streams.
- [ ] Record 5 "time to first word" values from the production URL in `benchmark-results.md`.

---

## Stage 5 — Desktop shell (Electron)

**Install (desktop):** `electron`, `typescript`, `tsx` or `esbuild` for building, `@playwright/test` (dev), `@kite/shared` (workspace).

**Create:**

| File | Contents |
|---|---|
| `apps/desktop/package.json` | Scripts: `dev` (opens `http://localhost:3000`), `start` (opens the production URL), `build`, `test` |
| `apps/desktop/tsconfig.json` | Extends the base config |
| `apps/desktop/src/config.ts` | `KITE_URL` (from env `KITE_URL`, default = the production `*.vercel.app` URL); `ALLOWED_ORIGIN` derived from it; `APP_NAME` |
| `apps/desktop/src/main.ts` | `ensureSingleInstance()` (a second launch focuses the existing window); `createMainWindow()` (1280×820, title "Kite", loads `KITE_URL`, shows only when ready); app lifecycle (quit on all windows closed, except macOS convention); applies `security.ts` |
| `apps/desktop/src/security.ts` | `lockNavigation(win)`: blocks navigation to any origin except `ALLOWED_ORIGIN`; `window.open` and external links open in the system browser. `allowOnlyOurPermissions(session)`: grants `media` (microphone) only to `ALLOWED_ORIGIN` and denies everything else. `secureWebPreferences()`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, preload path. |
| `apps/desktop/src/preload.ts` | `contextBridge.exposeInMainWorld('kiteDesktop', { version, os })`, typed with `KiteDesktopApi` from `@kite/shared`. Nothing else is exposed. |
| `apps/web` (update) | `Sidebar` footer shows "Desktop app vX.Y" when `isDesktop()`, otherwise "Browser" |
| `apps/desktop/tests/smoke.spec.ts` | Playwright for Electron: launches the app with `KITE_URL` pointing to a local test page (`tests/fixtures/index.html`), checks the window opens, `window.kiteDesktop.version` exists, and navigation to another origin is blocked |

**Check:**

- [ ] `pnpm --filter desktop start` opens the production app; sign-in works inside the window; the sidebar shows "Desktop app".
- [ ] `pnpm --filter desktop test` passes.

---

## Stage 6 — Speech-to-text spike (measure, not production)

**Goal:** prove that sherpa-onnx **WebAssembly** streaming ASR runs well enough in Chrome/Edge and inside the desktop app, then pick the model (ADR-0020). If it fails or is too slow, **stop and report the options**. Do not change the architecture silently.

**Create:**

| File | Contents |
|---|---|
| `apps/web/scripts/fetch-models.ts` + script `fetch-models` | Downloads the chosen model files and the sherpa-onnx WASM build from the official k2-fsa sherpa-onnx releases into `apps/web/public/models/stt/`; verifies SHA-256 checksums listed in the script; skips files already present |
| `apps/web/src/core/audio/resampler.worklet.ts` | AudioWorklet that converts microphone audio to 16 kHz mono `Float32Array` chunks of ~100 ms and posts them to the main thread |
| `apps/web/src/core/stt/stt.worker.ts` | Web Worker: loads the sherpa-onnx WASM module and the streaming model (following the official sherpa-onnx WebAssembly ASR example); `accept(samples)` → emits `{ type: 'partial', text }` and `{ type: 'final', text }`; also emits processing time per chunk |
| `apps/web/src/core/stt/sttClient.ts` | `startMicTranscription({ onPartial, onFinal, onStats })`: gets the mic via `getPlatform().getMicStream()`, starts the worklet and worker, returns `{ stop }`. Measures model load time and real-time factor (processing time ÷ audio time). |
| `apps/web/app/(app)/dev/stt-test/page.tsx` + `src/features/dev/SttTest.tsx` | Admin-only page: "Start / Stop", live partial text (grey) and final lines, stats (model size, load time, real-time factor, approximate lag) |
| `apps/web/next.config.ts` (update if needed) | Add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` **only if** the chosen WASM build needs threads (SharedArrayBuffer). Comment the reason either way. |

**Measure and record** (for each candidate tried; start with the streaming Zipformer English int8):

- model download size; first load time; cached load time;
- real-time factor in Chrome on this machine and inside the desktop app;
- approximate lag from speaking to partial text;
- rough accuracy (read the same 3 test sentences).

Write the numbers into `docs/testing/benchmark-results.md` and fill the **Decision** section of `docs/decisions/ADR-0020-stt-model.md` (status → Accepted).

---

## Stage 7 — CI and wrap-up

**Create:**

| File | Contents |
|---|---|
| `.github/workflows/ci.yml` | On pull request and push to `main`: **web** job on `ubuntu-latest` (pnpm install with a frozen lockfile, lint, typecheck, unit tests); **desktop** job builds and runs smoke tests on `windows-latest` (and `macos-latest` only on push to `main`, to save minutes). No secrets needed. Every step commented. |
| `docs/testing/benchmark-results.md` | Table: date, stage, machine/OS, browser or desktop, metric, value, notes |
| `README.md` (update) | Final Day 1 instructions: install, env, run web, run desktop, tests, deploy |

**Finish:**

1. Push the `day-01-setup` branch and open a pull request into `main`.
2. Check that CI is green and the Vercel preview works.
3. Print the **Day 1 summary**: what works, measured numbers, open issues for Day 2, and the Day 1 checklist below with each item ticked or explained.

## Day 1 checklist

- [ ] The web app runs locally and at `https://<project>.vercel.app`.
- [ ] Sign-in works: the admin creates users, the forced password change works, non-admins are blocked from admin pages, and disabling a user signs them out.
- [ ] `/dev/claude-test` streams Claude replies; prompt-cache reads are visible; first-word times are recorded.
- [ ] The desktop app opens the deployed app, and sign-in works inside it.
- [ ] The speech-to-text spike has measured numbers, and ADR-0020 is decided.
- [ ] CI is green on the pull request.
- [ ] Every file and function has the required comments (CLAUDE.md).
