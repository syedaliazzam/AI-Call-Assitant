/**
 * File: apps/web/next.config.ts
 * Purpose: Next.js configuration for the Kite web app.
 * Used by: `next dev`, `next build`, Vercel deployments
 * Depends on: @kite/shared (compiled from source, see transpilePackages)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.1 (Vercel project)
 */
import type { NextConfig } from 'next';

/**
 * Kite's Next.js settings.
 * No Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers: the official sherpa-onnx
 * WebAssembly ASR build (v1.13.7) is single-threaded (no pthreads), so it needs no
 * SharedArrayBuffer and therefore no cross-origin isolation (Day 1 Stage 6, ADR-0020).
 * Architecture §10.1 planned these headers for WebAssembly threads; they would only be needed
 * for a multi-threaded build.
 */
const nextConfig: NextConfig = {
  // @kite/shared ships TypeScript source (no build step), so Next.js must compile it.
  transpilePackages: ['@kite/shared'],
  // Stops `next dev` from writing apps/web/AGENTS.md. CLAUDE.md is the single rulebook for
  // this repository, and it already says to follow the official Next.js docs when they differ.
  agentRules: false,
};

export default nextConfig;
