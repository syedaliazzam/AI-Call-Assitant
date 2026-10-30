/**
 * File: packages/shared/src/index.ts
 * Purpose: Single entry point of @kite/shared; re-exports every shared type, and the request
 *          limits from api.ts and the hotkey defaults from hotkeys.ts.
 * Used by: apps/web and apps/desktop (`import type { ... } from '@kite/shared'`)
 * Depends on: ./api.ts, ./desktop-bridge.ts, ./hotkeys.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (packages/shared)
 */
export * from './api';
export type * from './desktop-bridge';
export * from './hotkeys';
