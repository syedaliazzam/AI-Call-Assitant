# Benchmark results (measured only)

Record **real measurements** here, never targets. The targets are in `docs/architecture/kite-architecture-v3.1.md` §6.2.

| Date | Stage / day | Machine + OS | Browser or desktop | Metric | Value | Notes |
|---|---|---|---|---|---|---|
| 2026-10-26 | Day 1 Stage 3 | Intel Core i5-8350U (4 cores / 8 threads), 24 GB RAM, Windows 11 Pro 10.0.26200 | Chrome 155.0.8059.86 | Time to first word, browser (`/dev/claude-test`, mode `hello`, `claude-haiku-5-5`) | 4171, 2371, 1293, 2155, 2311 ms (median of runs 2–5: 2233 ms) | Local dev server, Pakistan; database (Neon) and Claude API in US East. Run 1 is cold: it includes the Next.js dev compile of the route and the prompt-cache write. |
| 2026-10-26 | Day 1 Stage 3 | same | Chrome 155.0.8059.86 | Total reply time, browser | 4401, 2612, 1532, 2366, 2529 ms (median of runs 2–5: 2448 ms) | Local dev server, Pakistan. One-sentence reply. |
| 2026-10-26 | Day 1 Stage 3 | same | Chrome 155.0.8059.86 | Time to first word, server (request received → first text sent) | 2405, 2159, 1268, 2115, 2287 ms (median of runs 2–5: 2137 ms) | Local dev server, Pakistan. Measured before the server timing was split into auth / reaching Claude / Claude's first token; the split is recorded from Stage 4 on. |
| 2026-10-26 | Day 1 Stage 3 | same | Chrome 155.0.8059.86 | Tokens per request | input 28, output 27; cache write 1289 (run 1); cache read 1289 (runs 2–5) | Local dev server, Pakistan. Confirms prompt caching works: the 1289-token system block is written once and read on the following requests within 5 minutes. |
