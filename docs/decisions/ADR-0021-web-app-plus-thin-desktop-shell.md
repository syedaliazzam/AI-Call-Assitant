# ADR-0021: One web app (Vercel) + thin desktop shell (v3.0)

- **Status:** Accepted
- **Date:** 2026-10-24
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md`
- **Supersedes:** ADR-0019 (desktop-only Electron app with the API key on each laptop)

## Context

Kite must work as a desktop app (macOS, Windows) **and** in a browser, like ParakeetAI's "Desktop app / Open in browser" choice. It must stay simple, be built and tested in 7 days, and use the Claude API for answers. The company wants it at its own domain.

## Decision

- **One Next.js web app**, hosted on Vercel at `kite.company.com`, holds all screens and logic.
- **Desktop app** is a thin Electron shell that loads the same web app and adds native features through `window.kiteDesktop`: system-audio loopback, global hotkeys, an always-on-top live window, screenshots, and screen-share protection.
- All desktop/browser differences sit behind one `Platform` adapter.
- **Server** routes `/api/answer` and `/api/notes` hold the Claude key and stream replies; the server stores nothing.
- **Speech-to-text** runs on the laptop in the page (sherpa-onnx WebAssembly + Silero VAD).
- **Storage** is on the device (IndexedDB).
- **Sign-in** uses a company Google or Microsoft account (Auth.js).

## Consequences

- Code is written once; a Vercel deploy updates every user; no API key on laptops.
- The browser version is limited: calls must run in a browser tab, hotkeys work only while focused, and there is no screen-share protection.
- Sessions are per device; there is no sync in v3.0.
- **Vercel Pro is required for company use** ($20/month per developer seat).
- Text for answers (and screenshots on request) goes to Anthropic; audio stays local.

## Validation

Day 1 to 7 checks and latency measurement in `docs/architecture/kite-architecture-v3.1.md` §6.2 and §12.
