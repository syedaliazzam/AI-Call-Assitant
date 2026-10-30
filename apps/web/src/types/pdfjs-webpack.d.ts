/**
 * File: apps/web/src/types/pdfjs-webpack.d.ts
 * Purpose: Type declaration for 'pdfjs-dist/webpack.mjs', the entry point pdf.js recommends for
 *          bundlers (it starts pdf.js's worker with `new Worker(new URL(…))`). The package ships
 *          no types for this file, but it re-exports the main build, so the main types apply.
 * Used by: TypeScript, for src/core/documents/extract.ts
 * Depends on: pdfjs-dist (types/src/pdf.d.ts)
 * Architecture: day-03-sessions.md Stage 2 (pdf.js worker loaded the way its docs describe)
 */
declare module 'pdfjs-dist/webpack.mjs' {
  export * from 'pdfjs-dist';
}
