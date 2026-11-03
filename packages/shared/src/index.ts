/**
 * File: packages/shared/src/index.ts
 * Purpose: Single entry point of @kite/shared; re-exports every shared type, and the request
 *          limits from api.ts, the hotkey defaults from hotkeys.ts and the screenshot size rule.
 * Used by: apps/web and apps/desktop (`import type { ... } from '@kite/shared'`)
 * Depends on: ./api.ts, ./answer-meta.ts, ./desktop-bridge.ts, ./hotkeys.ts, ./screenshot.ts,
 *             ./notes.ts, ./prepare.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (packages/shared)
 */
export * from './answer-meta';
export * from './api';
export * from './desktop-bridge';
export * from './hotkeys';
export * from './screenshot';
export * from './notes';
export * from './lessons';
export * from './prepare';
export * from './keyTerms';
