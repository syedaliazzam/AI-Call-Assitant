/**
 * File: apps/web/scripts/check-dev-key.ts
 * Purpose: Runs before `next dev` (the "dev" script in apps/web/package.json): local
 *          development must use the development Claude key, never the production one. Exits
 *          with code 1 and the reason otherwise. Also usable alone: pnpm --filter web
 *          check-dev-key. Makes one free models request; no model is called.
 * Used by: the "dev" and "check-dev-key" scripts in apps/web/package.json
 * Depends on: scripts/lib/dev-key.ts
 * Architecture: CLAUDE.md "Separate Claude keys"
 */
import { requireDevKey } from './lib/dev-key';

await requireDevKey('check-dev-key');
