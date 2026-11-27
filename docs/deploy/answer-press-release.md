# Release: key-press answers, no split sentences, key terms, call memory (web only, 28 Nov 2026)

ADR-0132, ADR-0135, ADR-0136, ADR-0137; architecture 4.70.0. The contract and live prompt are unchanged (ADR-0133 and ADR-0134 are a separate prompt round). Web only: the desktop apps (Mac 1.8.2, Windows 1.7.6) load the new site with no update.

- **Rollback target, recorded before the deploy:** production was `https://kite-call-assistant-7ghql5kom-paramount-intelligence.vercel.app` (`dpl_CM6FhuZy9F9qJAqqW4TLAUyjvJ3x`, created 27 Nov 2026 20:46 PKT, `main` @ `137a5f9`).
- **Rollback:** `vercel rollback https://kite-call-assistant-7ghql5kom-paramount-intelligence.vercel.app --yes` (from a folder linked to `kite-call-assistant`). Everyone is back on the previous site within a minute. After a rollback, new deploys need `vercel promote`. Then fix forward on a branch, and `git revert -m 1 <merge commit>` on `main` if the merge itself is the problem. Nothing is stored differently, so a rollback loses nothing (the call memory lives only in memory during a call).

## Gate (before the deploy)

- `pnpm lint && pnpm typecheck && pnpm test`.
- Key-press evaluation (`scripts/eval-press.ts`, 25 invented snippets): every row equal or better than production measured the same day; "no 'not sure'" and "usable as-is" at least 24/25.
- Full `eval:answers --guard` against production measured the same day: no group worse.

## After the deploy

- Production end-to-end with a disposable test account (`create-e2e-user --prod`), deleted afterwards (`delete-test-accounts --prod`).
- Results: see the bottom of this file.

## First attempt (28 Nov 2026): not deployed

The key-press evaluation passed, but the full suite was worse than production in 8 of 16 groups (hallucination-bait 6.83 → 5.92, cv-embellishment 6.38 → 5.50, screenshot-types 9.64 → 8.71; `docs/testing/answer-eval.md`). Production is unchanged (`dpl_CM6FhuZy9F9qJAqqW4TLAUyjvJ3x`). The disposable test account made for the investigation was deleted (`delete-test-accounts --prod`).

## Second attempt (28 Nov 2026): the release set without prompt changes

- Gate: lint, typecheck and tests pass; the full suite's differences were shown to be noise (`--prompt-hashes`: all 114 prompts identical to production's; `docs/testing/answer-eval.md`).
- Production before the deploy, request → first visible word of `/api/answer` from the dev laptop (10 invented press requests, disposable account): 753 ms median, 1,096 ms p90.
