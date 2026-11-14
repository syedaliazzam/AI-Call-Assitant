# Kite

Kite is our internal call assistant. During a call it shows a live transcript of both sides and, when you press a key, streams a short answer from Claude using the session's details and documents.

It runs as a desktop app (macOS, Windows) and in Chrome or Edge. Start with [CLAUDE.md](CLAUDE.md) and [the architecture](docs/architecture/kite-architecture-v3.1.md).

## Repository layout

| Folder            | What it is                                                           |
| ----------------- | -------------------------------------------------------------------- |
| `apps/web`        | The application: Next.js (App Router) deployed to Vercel             |
| `apps/desktop`    | Thin Electron shell that opens the web app (built in Day 1 Stage 5)  |
| `packages/shared` | TypeScript types shared by both apps (API, desktop bridge, hotkeys)  |
| `docs`            | Architecture, decisions (ADRs), daily instructions, measured results |

## Prerequisites

- **Node.js 22.22.2 or later** (Node 24 recommended). Vitest 5 does not run on Node 20; `pnpm lint` needs 22.22.2+ (eslint-plugin-jsdoc, and the header check runs a `.ts` file directly with Node).
- **pnpm 12**: run `corepack enable` once; the version is pinned in `package.json` (`packageManager`).
- Git.

## Set up a development machine (once)

Steps 1–2 are needed for everything; steps 3–5 for sign-in and Claude; step 6 for speech-to-text in development (live sessions, `/dev/stt-test`, `test:stt`).

**1. Install the dependencies.**

```sh
pnpm install
```

**2. Get the Vercel CLI** (`npm i -g vercel`, then `vercel login`) and link this folder to the project. Run it from the **repository root**:

```sh
vercel link        # project kite-call-assistant, root directory apps/web
```

**3. Download the environment variables** into `apps/web/.env.local` (git-ignored). The variable names and what they are for are listed in [apps/web/.env.example](apps/web/.env.example).

```sh
vercel env pull apps/web/.env.local
```

Secrets live only in Vercel. To add one, run `vercel env add NAME` and paste the value at the terminal prompt only (never in code, commits, logs or chat), then pull again.

**4. Prepare the accounts database** (only for a new database; the shared Neon database is already migrated):

```sh
pnpm --filter web db:migrate --prod
```

**5. Create the first admin** (only once per database; after that, admins add users at `/admin/users`). It prints a temporary password once; you must change it at first sign-in.

```sh
pnpm --filter web create-admin --prod --email you@company.com --name "Your Name"
```

**6. Download the speech-to-text files** (about 205 MB of files to keep; the first run also downloads a 175 MB release archive to take the runtime from). They are not in git:

```sh
pnpm --filter web fetch-models
```

It downloads them from the official sherpa-onnx sources (pinned versions) and checks every SHA-256. Run it again at any time; files that are already correct are skipped. What goes where:

- the **runtime** (13.3 MB) goes to `apps/web/public/stt-runtime/v1.13.7/`;
- the **model** (Zipformer 2023-06-21, 191 MB) and two official test recordings go to `apps/web/public/models/stt/`.

**How model files load:**

- **Development** (`pnpm dev`): from `public/models/stt/` on your machine (works offline).
- **Production:** straight from pinned Hugging Face URLs. The browser checks each file's SHA-256 and keeps it in Cache Storage, so only the first load downloads (about 205 MB, with a progress bar).
- **Runtime:** always served from our own site. Every build fetches it (`pnpm run stt:runtime`).
- **Override:** set `NEXT_PUBLIC_STT_SOURCE=local` or `remote`.

See [ADR-0023](docs/decisions/ADR-0023-stt-model-hosting.md).

## Run the web app

```sh
pnpm dev
```

Open http://localhost:3000 and sign in. To try a live call, create a session on the dashboard, then **Open** it (in the browser, choose **Open in browser**). Use headphones, so the microphone does not pick up the other side.

1. Click **Connect**.
2. Pick where the other side comes from:
   - **desktop app:** this computer's sound, with no picker;
   - **browser:** pick the meeting tab and turn on **"Also share tab audio"**.
3. Talk. Your microphone is labelled **You** and the call is labelled **Them**. Grey text is still being heard; lines become final at pauses.

Admins also see **Dev tools** in the sidebar:

- `/dev/stt-test`: speech-to-text with load time, real-time factor, lag, end of speech → final line latency (p50/p95) and the word error rate on 3 test sentences. "Hotwords from" fills the hotwords from a session; "Beam width" (4 or 8) is for measuring only. "Copy results" gives the text for `docs/testing/benchmark-results.md`.
- `/dev/claude-test`: streams a Claude reply and shows timings. "Warm with session" sends two warm-ups for a session on this computer and shows the cache write, then the cache read.

Speech-to-text runs on your device; audio never leaves it. Known limitation: names and technical terms are often misheard ([ADR-0020](docs/decisions/ADR-0020-stt-model.md)). Session key terms help a little; the answer prompt tells Claude to expect misheard names.

### Sessions, documents and settings

- **Create session** (dashboard): step 1 Details (type, company, role or topic, description, documents), step 2 Preferences (model, answer style, **key terms**, instructions, save transcript). **Edit** and **Delete** are on each session card.
- **Documents:** PDF, DOCX or TXT, read into text **on this computer**. Limits: 20 MB per file, 100,000 characters per document, 150,000 per session. Encrypted PDFs and scanned (image-only) PDFs are refused with a clear message.
- **Key terms** (one per line), the company, the role or topic and the document names become speech-to-text hotwords for the session ("Listening for N key terms" on the Connect view). They are also sent to Claude so it can recognise misheard names.
- **Warm-up:** opening a session's live screen sends a warm-up (`mode: "warm"`, no answer), and Connect sends another, so the first answer reads Claude's prompt cache. The screen never waits for it. During a call, 4.5 quiet minutes trigger one more warm-up (with the conversation so far).
- **Saved transcript:** with "Save transcript" on, final lines are saved on this computer and shown under the Connect view next time. Echo lines are never saved.
- **Settings:** the default preferences for new sessions, and **Delete all local data** (keeps the downloaded speech model).
- **Where it is stored:** IndexedDB on this computer ([ADR-0024](docs/decisions/ADR-0024-local-session-storage.md)). **The browser and the desktop app each have their own sessions**, and so does each browser profile: a session created in Chrome does not appear in the desktop app. There is no sync in v1.

### Answers during a call (Day 4)

- **Answer** (button, or **Ctrl+Enter** / **⌘ Enter**) answers the latest question from the other person. The panel shows the question it used ("from N lines"), the headline as it streams, then the bullets, and the time to the first word.
- **Chat** opens a box for a typed question: Enter sends it, Escape clears it.
- **Clear** (Ctrl+Backspace / ⌘ Backspace) stops an answer that is still streaming, or hides the one shown. **Previous / Next** (Ctrl+← / Ctrl+→, ⌘ ← / ⌘ →) move through the session's answers. **Copy** copies the answer as plain text. Screenshot arrives on Day 5.
- **Hotkeys:** in the browser they work while the Kite tab has focus. In the desktop app they are **global during a call** (they work while the meeting app has focus) and are released at End. If another app already uses one, the live view says which; it then works only while Kite is in front. While you type in a text box, the shortcuts are left to the text box.
- **What Claude sees:** the session details and documents, **the whole call so far** and the answers already given in it, so answers stay consistent ([ADR-0025](docs/decisions/ADR-0025-answer-context-and-learning.md)). Over about 90 minutes, the oldest part of the call is left out.
- **Ratings:** 👍 / 👎 and an optional "What was wrong / better answer" note on each answer. Answers, ratings and notes are saved on this computer **even when "Save transcript" is off** (the review page and Day 5's learning need them), and are deleted with the session.
- **End** waits a moment for the line still being spoken, so it is saved too.

Developer checks against the real Claude API (never in CI; they use `apps/web/.env.local` and print only token counts, times and scores):

```sh
pnpm --filter web verify:warm           # PASS = call 1 writes the cache, call 2 reads the same number of tokens
pnpm --filter web verify:answer-cache   # PASS = 3 answers on a growing call: each reads everything cached before it
pnpm --filter web eval:answers          # answer-quality score table (15 invented scenarios × 2 runs, Haiku graded by Sonnet)
pnpm --filter web eval:answers --only 08-documents-cannot-answer --runs 1 --show   # one scenario, with the answers (local only)
```

The rubric, the scenarios and every result are in [docs/testing/answer-eval.md](docs/testing/answer-eval.md).

**`/dev/latency`** (admins): runs a warm-up and 20 answers on an invented session through the live client path, and shows p50/p95 for key press → request sent → first word → headline → done, the server's own share, and cache hits. "Copy results" copies the numbers only.

## Run the desktop app

The desktop app is a thin Electron shell around the web app (`apps/desktop`). No installer yet; it runs from source.

```sh
pnpm --filter desktop dev     # opens http://localhost:3000 (start `pnpm dev` first)
pnpm --filter desktop start   # opens production: https://kite-call-assistant.vercel.app
```

- Set `KITE_URL` to open another address (it overrides both). Only `https://` is accepted, or `http://` on localhost.
- The first run downloads the Electron binary (about 100 MB, verified against Electron's published checksums). `pnpm --filter desktop electron:install` does that step on its own.
- The window only shows the Kite origin. Navigation to any other origin is blocked, and links opened in a new window go to your normal browser (http/https only). A future payment or SSO page on another origin must be added to the allowlist on purpose.
- Started from a tool that is itself an Electron app (for example a VS Code extension)? Make sure `ELECTRON_RUN_AS_NODE` is not set, or Electron starts as plain Node.js.

## Check and test

```sh
pnpm lint        # ESLint (with the JSDoc rules) + file-header check + Prettier check
pnpm typecheck   # TypeScript in every package
pnpm test        # Vitest unit tests (web, and the desktop shell's rules)
pnpm format      # apply Prettier formatting
pnpm --filter desktop test   # Electron smoke test: launches the real shell against a test page
pnpm --filter web test:stt   # speech-to-text integration test (needs step 6; see below)
pnpm --filter web test:answers   # answer UI harness test: mocked streaming answers, no sign-in (about 15 s)
```

`pnpm lint && pnpm typecheck && pnpm test` must pass before every commit. Unit tests never call the real Claude API and need no secrets.

Run a command in a single package with `--filter`, for example `pnpm --filter web test`.

**Production end-to-end test accounts are disposable** (since 14 Nov 2026). Production has no standing test accounts: the two long-lived ones (`kite-e2e@example.com`, `kite-e2e-admin@example.com`) were deleted with their data. Create an account just before a run and delete it straight after:

```sh
pnpm --filter web create-e2e-user --prod           # role user: KITE_E2E_EMAIL / KITE_E2E_PASSWORD in apps/web/.env.local
pnpm --filter web create-e2e-user --prod --admin   # role admin (latency, unflagged, the domain "admin page" check): KITE_E2E_ADMIN_*
#   ... run the suites ...
pnpm --filter web delete-test-accounts             # dry run: the SQL it would run and the row counts per table
pnpm --filter web delete-test-accounts --prod      # deletes the accounts and their data, and removes their lines from .env.local
```

- `create-e2e-user` creates the account as an admin would, completes its first password change, and appends the email and a generated password to `apps/web/.env.local` (git-ignored, never printed). It refuses when those lines are already there.
- `delete-test-accounts` acts only on `kite-e2e…@example.com` addresses (the default test addresses, and those named by `KITE_E2E_EMAIL` / `KITE_E2E_ADMIN_EMAIL` in `.env.local`), never on a real account. It deletes the sign-in sessions, the credential, daily request counts, synced call data, Google Drive rows and desktop link codes in one transaction, and prints counts only.
- The account sync suites (`sync-devices.spec.ts`) need the account in `KITE_SYNC_USERS` unless it is `*`: `sync-user-ids` adds `KITE_E2E_EMAIL` to the ids it prints.
- `vercel env pull` rewrites `.env.local` and removes the lines: delete the account and create a new one.

**Production end-to-end suites** (`apps/web/tests/e2e-prod/`, manual only, never in CI). They run against https://call.paramountintelligence.co (or `KITE_E2E_URL`) as a disposable test account (above), and print only PASS/FAIL with numbers:

```sh
pnpm --filter web test:e2e-prod chrome.spec.ts desktop.spec.ts   # builds the desktop shell, then runs both suites (about 3 minutes)
```

(Without file names it also runs `latency.spec.ts`, which needs a disposable admin test account.)

- **Chrome** (`chrome.spec.ts`), using Playwright's Chromium in headless mode:
  - sign in;
  - create a session with an invented one-page `.txt` and key terms;
  - Open in browser shows "Listening for N key terms";
  - the live page's warm-up writes the cache, and a second warm-up (reload) reads it;
  - Connect with Chromium's fake microphone and a fake shared tab, both playing official test recordings;
  - Connect starts the call (no second step), final lines appear;
  - **Answer with Ctrl+Enter:** the headline streams in, the answer reads the cache, and it is rated 👍;
  - End, "Saved transcript" survives a reload (and holds at least the lines seen live);
  - the session is deleted.
- **Desktop** (`desktop.spec.ts`): the real Electron shell with a fresh profile, on production:
  - sign in, and the dashboard is empty (its own data);
  - create a session;
  - Open goes straight to Connect;
  - Connect shows no picker;
  - Connect starts the call (no second step), final lines appear;
  - **a typed Chat question** streams an answer, which is rated 👍 (the test machine plays no "Them" audio, so there is no question for the Answer key);
  - End;
  - Delete all local data leaves the dashboard empty.
- Each run downloads the speech model again (about 1 minute), because the browser profiles are fresh.
- **Known test-environment effect:** with Chromium's fake media, the "You" channel also hears the fake "Them" audio. Its lines repeat "Them", and the echo filter hides them (as it should), so the suites count final lines from either side. A real microphone shows "You" lines as normal.

**Speech-to-text integration test** (`test:stt`): Chromium's fake microphone plays two official LibriSpeech recordings (`apps/web/tests/fixtures/audio/`, see its `SOURCES.md`) through the real pipeline. It checks for a final line and a word error rate of 10% or less.

- **Once per machine:** `pnpm --filter web exec playwright install chromium`, plus step 6.
- **Without the model files**, it is skipped with a message. In CI it fails instead.
- It takes about a minute, because the recordings play in real time.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on GitHub Actions. Minutes are limited on this private repository (Windows minutes count 2x, macOS 10x), so:

| Job                          | Runner  | Runs on                                          | What it does                                                              |
| ---------------------------- | ------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Web                          | Ubuntu  | every pull request and push to `main`            | `pnpm install --frozen-lockfile`, actionlint, lint, typecheck, unit tests |
| Speech-to-text integration   | Ubuntu  | every pull request and push to `main`            | fetches the pinned STT files (SHA-256 checked, cached), runs `test:stt`   |
| Desktop smoke test (Windows) | Windows | every pull request and push to `main`            | installs Electron, builds the shell, runs the Playwright smoke test       |
| Desktop smoke test (macOS)   | macOS   | **manual only**: Actions tab → CI → Run workflow | the same smoke test on macOS (a manual run starts only this job)          |

CI uses no secrets, makes no Claude calls and deploys nothing. The pnpm store, the Electron download and the speech-to-text files are cached between runs. The STT cache key is the hash of every pinned SHA-256 (`tsx scripts/fetch-models.ts --pins`), so changing a pin downloads fresh files.

## Deploy

Kite is deployed to Vercel **with the Vercel CLI only**: there is no Git integration, so pushes and pull requests do not create deployments. The Vercel project is `kite-call-assistant`, with **Root Directory `apps/web`**. Run every command below from the **repository root** (where `.vercel/` is), so the whole monorepo is uploaded and `@kite/shared` is available to the build.

**One-time project setup** (already done for `kite-call-assistant`):

```sh
vercel link                                    # root directory: apps/web
vercel env add ENABLE_EXPERIMENTAL_COREPACK    # value 1, all environments (see below)
vercel env add BETTER_AUTH_URL production --no-sensitive --force   # https://<production domain>
vercel env add KITE_TRUSTED_ORIGINS production --no-sensitive      # every address production answers on
```

The other variables (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, `KITE_MODEL_FAST`, `KITE_MODEL_SMART`) are listed in [apps/web/.env.example](apps/web/.env.example). Pull them for local development with `vercel env pull apps/web/.env.local`.

**Deploy:**

```sh
vercel deploy          # preview deployment: prints a unique https://…vercel.app URL
vercel deploy --prod   # production deployment: https://<production domain>
```

**If a deploy says "Deployment Blocked":** on the Vercel Hobby plan, Vercel only deploys when the author email of the latest commit matches the email of the Vercel account. Set this repository's commit email to the Vercel account's email (repo-local, so other projects are unaffected): `git config user.email "<Vercel account email>"`, make a new commit, and deploy again.

Every build first runs `pnpm run stt:runtime`. It downloads the 175 MB sherpa-onnx release archive from GitHub, checks its SHA-256, and unpacks the three runtime files (13.3 MB, each checked) into `public/stt-runtime/`. A wrong checksum or a missing file fails the build with the file's name. The model files are not deployed (ADR-0023).

Database migrations are not run by the deploy. When `apps/web/drizzle/` gains a new migration, run `pnpm --filter web db:migrate --prod` (it uses `DATABASE_URL` from `apps/web/.env.local`, which points at the same Neon database) before deploying the code that needs it.

**Why the settings are what they are** (JSON files cannot hold comments, so the reasons live here):

- [apps/web/vercel.json](apps/web/vercel.json)
  - `"regions": ["iad1"]`: functions run in US East (Washington, D.C.), next to the Neon database (also `iad1`) and close to the Claude API, so the sign-in check and the call to Claude each cross only a short distance. Users far away pay the distance once, on their own connection to Vercel.
  - `"installCommand": "pnpm install --frozen-lockfile"`: installs the whole pnpm workspace exactly as locked; the build fails instead of silently installing different versions.
- `ENABLE_EXPERIMENTAL_COREPACK=1`: makes Vercel use the pnpm version pinned in the root `package.json` (`packageManager`). Without it, Vercel picks pnpm 9 or 10 from the lockfile format, which does not understand the `allowBuilds` setting in `pnpm-workspace.yaml`.
- [.vercelignore](.vercelignore): keeps every `.env*` file except `.env.example` and the `docs/` folder out of CLI uploads.
- Production answers on two addresses: https://call.paramountintelligence.co and https://kite-call-assistant.vercel.app, which installed desktop apps load and which must never redirect. Steps, checks and rollback: [docs/deploy/subdomain.md](docs/deploy/subdomain.md).
- `NEXT_PUBLIC_BRANDFETCH_CLIENT_ID` turns on company suggestions and logos (ADR-0048). It reaches the browser and is not a secret. Next.js writes it in at build time, so a change needs a new deploy. Without it, the company field suggests from past sessions only.
- Preview deployments leave `BETTER_AUTH_URL` unset and use their own `https://$VERCEL_URL` (see `apps/web/src/server/env.ts`). Previews may require a Vercel login (Deployment Protection); production does not.
