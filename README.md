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

- **Node.js 22.12 or later** (Node 24 recommended). Vitest 5 does not run on Node 20.
- **pnpm 12**: run `corepack enable` once; the version is pinned in `package.json` (`packageManager`).
- Git.

## Set up a development machine (once)

Steps 1–2 are needed for everything; steps 3–5 for sign-in and Claude; step 6 only for the speech-to-text test page.

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

**6. Download the speech-to-text model files** (about 280 MB, both models). They are needed only for `/dev/stt-test` (admins only) and are not in git:

```sh
pnpm --filter web fetch-models
```

It downloads them from the official sherpa-onnx sources (pinned versions), checks every SHA-256, and puts them in `apps/web/public/models/stt/`. Run it again at any time; files that are already correct are skipped. They are not uploaded to Vercel; see [ADR-0020](docs/decisions/ADR-0020-stt-model.md) for how production should serve them (decided on Day 2).

## Run the web app

```sh
pnpm dev
```

Open http://localhost:3000 and sign in. Admins also see **Dev tools** in the sidebar: `/dev/claude-test` (streams a Claude reply and shows timings) and `/dev/stt-test` (live speech-to-text with load time, real-time factor, lag and accuracy).

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
pnpm lint        # ESLint + Prettier check
pnpm typecheck   # TypeScript in every package
pnpm test        # Vitest unit tests (web, and the desktop shell's rules)
pnpm format      # apply Prettier formatting
pnpm --filter desktop test   # Electron smoke test: launches the real shell against a test page
```

`pnpm lint && pnpm typecheck && pnpm test` must pass before every commit. Unit tests never call the real Claude API and need no secrets.

Run a command in a single package with `--filter`, for example `pnpm --filter web test`.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on GitHub Actions. Minutes are limited on this private repository (Windows minutes count 2x, macOS 10x), so:

| Job                          | Runner  | Runs on                                          | What it does                                                        |
| ---------------------------- | ------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Web                          | Ubuntu  | every pull request and push to `main`            | `pnpm install --frozen-lockfile`, lint, typecheck, unit tests       |
| Desktop smoke test (Windows) | Windows | every pull request and push to `main`            | installs Electron, builds the shell, runs the Playwright smoke test |
| Desktop smoke test (macOS)   | macOS   | **manual only**: Actions tab → CI → Run workflow | the same smoke test on macOS (a manual run starts only this job)    |

CI uses no secrets, makes no Claude calls, downloads no speech-to-text models and deploys nothing. The pnpm store and the Electron download are cached between runs.

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

Database migrations are not run by the deploy. When `apps/web/drizzle/` gains a new migration, run `pnpm --filter web db:migrate` (it uses `DATABASE_URL` from `apps/web/.env.local`, which points at the same Neon database) before deploying the code that needs it.

**Why the settings are what they are** (JSON files cannot hold comments, so the reasons live here):

- [apps/web/vercel.json](apps/web/vercel.json)
  - `"regions": ["iad1"]`: functions run in US East (Washington, D.C.), next to the Neon database (also `iad1`) and close to the Claude API, so the sign-in check and the call to Claude each cross only a short distance. Users far away pay the distance once, on their own connection to Vercel.
  - `"installCommand": "pnpm install --frozen-lockfile"`: installs the whole pnpm workspace exactly as locked; the build fails instead of silently installing different versions.
- `ENABLE_EXPERIMENTAL_COREPACK=1`: makes Vercel use the pnpm version pinned in the root `package.json` (`packageManager`). Without it, Vercel picks pnpm 9 or 10 from the lockfile format, which does not understand the `allowBuilds` setting in `pnpm-workspace.yaml`.
- [.vercelignore](.vercelignore): keeps every `.env*` file except `.env.example` and the `docs/` folder out of CLI uploads.
- Preview deployments leave `BETTER_AUTH_URL` unset and use their own `https://$VERCEL_URL` (see `apps/web/src/server/env.ts`). Previews may require a Vercel login (Deployment Protection); production does not.
