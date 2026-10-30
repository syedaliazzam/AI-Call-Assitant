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
pnpm --filter web db:migrate
```

**5. Create the first admin** (only once per database; after that, admins add users at `/admin/users`). It prints a temporary password once; you must change it at first sign-in.

```sh
pnpm --filter web create-admin --email you@company.com --name "Your Name"
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
- **Warm-up:** opening a session's live screen sends a warm-up (`mode: "warm"`, no answer), so the first answer reads Claude's prompt cache. The screen never waits for it.
- **Saved transcript:** with "Save transcript" on, final lines are saved on this computer and shown under the Connect view next time. Echo lines are never saved.
- **Settings:** the default preferences for new sessions, and **Delete all local data** (keeps the downloaded speech model).
- **Where it is stored:** IndexedDB on this computer ([ADR-0024](docs/decisions/ADR-0024-local-session-storage.md)). **The browser and the desktop app each have their own sessions**, and so does each browser profile: a session created in Chrome does not appear in the desktop app. There is no sync in v1.

Check the warm-up against the real Claude API (developer only, never in CI; uses `apps/web/.env.local` and prints only token counts and times):

```sh
pnpm --filter web verify:warm   # PASS = call 1 writes the cache, call 2 reads the same number of tokens
```

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
```

`pnpm lint && pnpm typecheck && pnpm test` must pass before every commit. Unit tests never call the real Claude API and need no secrets.

Run a command in a single package with `--filter`, for example `pnpm --filter web test`.

**Production end-to-end test account.** The manual production suites (below) sign in as a dedicated account, `kite-e2e@example.com` (role user), created once with:

```sh
pnpm --filter web create-e2e-user   # creates the account, completes its first password change,
                                    # appends KITE_E2E_EMAIL / KITE_E2E_PASSWORD to apps/web/.env.local
```

- The password is generated, never printed, and stored only in `apps/web/.env.local` (git-ignored).
- **To disable the account:** sign in as an admin → **Admin** in the sidebar (`/admin/users`) → find `kite-e2e@example.com` → **Disable**. Its sign-in sessions end immediately, and the suites then fail at sign-in. **Enable** turns it back on.
- `vercel env pull` rewrites `.env.local` and removes the two lines. To restore them, add them back by hand, or reset the password at `/admin/users` and then sign in once as the account to choose a new one.

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
vercel env add BETTER_AUTH_URL production      # https://<production domain>
```

The other variables (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, `KITE_MODEL_FAST`, `KITE_MODEL_SMART`) are listed in [apps/web/.env.example](apps/web/.env.example). Pull them for local development with `vercel env pull apps/web/.env.local`.

**Deploy:**

```sh
vercel deploy          # preview deployment: prints a unique https://…vercel.app URL
vercel deploy --prod   # production deployment: https://<production domain>
```

**If a deploy says "Deployment Blocked":** on the Vercel Hobby plan, Vercel only deploys when the author email of the latest commit matches the email of the Vercel account. Set this repository's commit email to the Vercel account's email (repo-local, so other projects are unaffected): `git config user.email "<Vercel account email>"`, make a new commit, and deploy again.

Every build first runs `pnpm run stt:runtime`. It downloads the 175 MB sherpa-onnx release archive from GitHub, checks its SHA-256, and unpacks the three runtime files (13.3 MB, each checked) into `public/stt-runtime/`. A wrong checksum or a missing file fails the build with the file's name. The model files are not deployed (ADR-0023).

Database migrations are not run by the deploy. When `apps/web/drizzle/` gains a new migration, run `pnpm --filter web db:migrate` (it uses `DATABASE_URL` from `apps/web/.env.local`, which points at the same Neon database) before deploying the code that needs it.

**Why the settings are what they are** (JSON files cannot hold comments, so the reasons live here):

- [apps/web/vercel.json](apps/web/vercel.json)
  - `"regions": ["iad1"]`: functions run in US East (Washington, D.C.), next to the Neon database (also `iad1`) and close to the Claude API, so the sign-in check and the call to Claude each cross only a short distance. Users far away pay the distance once, on their own connection to Vercel.
  - `"installCommand": "pnpm install --frozen-lockfile"`: installs the whole pnpm workspace exactly as locked; the build fails instead of silently installing different versions.
- `ENABLE_EXPERIMENTAL_COREPACK=1`: makes Vercel use the pnpm version pinned in the root `package.json` (`packageManager`). Without it, Vercel picks pnpm 9 or 10 from the lockfile format, which does not understand the `allowBuilds` setting in `pnpm-workspace.yaml`.
- [.vercelignore](.vercelignore): keeps every `.env*` file except `.env.example` and the `docs/` folder out of CLI uploads.
- Preview deployments leave `BETTER_AUTH_URL` unset and use their own `https://$VERCEL_URL` (see `apps/web/src/server/env.ts`). Previews may require a Vercel login (Deployment Protection); production does not.
