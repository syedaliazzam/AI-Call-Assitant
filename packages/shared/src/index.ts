/**
 * File: packages/shared/src/index.ts
 * Purpose: Single entry point of @kite/shared; re-exports every shared type, and the request
 *          limits from api.ts, the hotkey defaults from hotkeys.ts and the screenshot size rule.
 * Used by: apps/web and apps/desktop (`import type { ... } from '@kite/shared'`)
 * Depends on: ./api.ts, ./answer-meta.ts, ./desktop-bridge.ts, ./hotkeys.ts, ./screenshot.ts,
 *             ./notes.ts, ./prepare.ts, ./sync.ts (ADR-0049), ./recording.ts (ADR-0068),
 *             ./drive.ts (ADR-0072), ./aiInstructions.ts (ADR-0083, ADR-0089), ./speakers.ts (ADR-0093)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (packages/shared)
 */
export * from './aiInstructions';
export * from './answer-meta';
export * from './api';
export * from './desktop-bridge';
export * from './drive';
export * from './hotkeys';
export * from './screenshot';
export * from './notes';
export * from './lessons';
export * from './prepare';
export * from './protocol';
export * from './recording';
export * from './keyTerms';
export * from './sync';
export * from './speakers';
