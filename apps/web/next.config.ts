/**
 * File: apps/web/next.config.ts
 * Purpose: Next.js configuration for the Kite web app.
 * Used by: `next dev`, `next build`, Vercel deployments
 * Depends on: @kite/shared (compiled from source, see transpilePackages)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.1 (Vercel project); ADR-0020
 */
import type { NextConfig } from 'next';

/**
 * Cross-origin isolation (PROVISIONAL, Day 2 Stage 5, ADR-0020): the second-pass runtime
 * (official sherpa-onnx v1.13.2 vad-asr WebAssembly) is a threads build that needs
 * SharedArrayBuffer, which Chrome only allows on a cross-origin-isolated page. The streaming
 * runtime (v1.13.7) is single-threaded and needs none of this.
 * - COOP same-origin: the page shares no browsing context group with other sites' windows.
 * - COEP credentialless (tried first, the developer's choice): cross-origin requests without
 *   CORS are sent without cookies instead of being blocked; Hugging Face model downloads are
 *   CORS requests and are allowed either way. `require-corp` is the fallback only if
 *   credentialless turns out not to give isolation somewhere we need it.
 * Applied to EVERY page: a page is isolated only from its first load, so a client-side
 * navigation into /live or /dev/stt-test from a page without the headers would not be.
 * If Stage 5 adopts no second pass, these headers are removed again (ADR-0020).
 */
const CROSS_ORIGIN_ISOLATION_HEADERS = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
];

/**
 * Kite's Next.js settings.
 */
const nextConfig: NextConfig = {
  // @kite/shared ships TypeScript source (no build step), so Next.js must compile it.
  transpilePackages: ['@kite/shared'],
  // Stops `next dev` from writing apps/web/AGENTS.md. CLAUDE.md is the single rulebook for
  // this repository, and it already says to follow the official Next.js docs when they differ.
  agentRules: false,

  /**
   * Response headers for every route (see CROSS_ORIGIN_ISOLATION_HEADERS).
   *
   * @returns The header rules.
   */
  async headers() {
    return [{ source: '/:path*', headers: CROSS_ORIGIN_ISOLATION_HEADERS }];
  },
};

export default nextConfig;
