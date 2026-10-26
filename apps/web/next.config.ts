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
 * Stage 6 may add COOP/COEP headers here if the speech-to-text WebAssembly build needs threads.
 */
const nextConfig: NextConfig = {
  // @kite/shared ships TypeScript source (no build step), so Next.js must compile it.
  transpilePackages: ['@kite/shared'],
  // Stops `next dev` from writing apps/web/AGENTS.md. CLAUDE.md is the single rulebook for
  // this repository, and it already says to follow the official Next.js docs when they differ.
  agentRules: false,
};

export default nextConfig;
