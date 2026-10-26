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

## Install

```sh
pnpm install
```

## Run

```sh
pnpm dev
```

Open http://localhost:3000. You should see the sidebar and the empty "Call Sessions" dashboard.

## Check and test

```sh
pnpm lint        # ESLint + Prettier check
pnpm typecheck   # TypeScript in every package
pnpm test        # Vitest unit tests
pnpm format      # apply Prettier formatting
```

All three checks must pass before every commit.

Run a command in a single package with `--filter`, for example `pnpm --filter web test`.

## Deploy

Deployment uses the Vercel CLI. The exact commands are added in Day 1 Stage 4 (see [docs/implementation/day-01-setup.md](docs/implementation/day-01-setup.md)).
