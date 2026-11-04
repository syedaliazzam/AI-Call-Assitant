/**
 * File: apps/web/src/core/documents/extract.ts
 * Purpose: Turns a PDF, DOCX or TXT file into plain text on the user's laptop, for the session
 *          prompt. Expected problems (wrong type, too large, password-protected, no text layer,
 *          unreadable) come back as a typed DocumentError, never as a thrown exception.
 * Used by: the Create/Edit session wizard (Day 3 Stage 3)
 * Depends on: pdfjs-dist (PDF text, Mozilla's official library), mammoth (DOCX text),
 *             src/core/documents/limits.ts (MAX_FILE_BYTES)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/documents), §8.1;
 *               day-03-sessions.md Stage 2
 *
 * Privacy: the file is read in the browser; nothing is uploaded here. Document text is the
 * user's content and is never logged (only names, sizes and counts may be).
 *
 * pdf.js worker: loaded the way pdf.js's documentation recommends for bundlers, by importing
 * 'pdfjs-dist/webpack.mjs'. That entry starts pdf.js's worker itself with
 * `new Worker(new URL('./build/pdf.worker.mjs', import.meta.url), { type: 'module' })`; Next.js
 * bundles the worker file and serves it from our own origin like any other script chunk. No
 * COOP/COEP headers are involved (Day 2 decision). pdf.js and mammoth are imported only when a
 * file of their type is read, so they never load during server rendering or on other pages.
 */
import { MAX_FILE_BYTES } from './limits';

/** The kinds of document Kite reads. */
export type DocumentKind = 'pdf' | 'docx' | 'txt';

/** Why a document could not be read. */
export type DocumentErrorCode =
  /** Not a PDF, DOCX or TXT file (for example an old .doc, or an image). */
  | 'unsupported-type'
  /** Bigger than MAX_FILE_BYTES. */
  | 'too-large'
  /** A password-protected PDF. */
  | 'encrypted'
  /** No text inside, for example a scanned PDF (OCR is not supported in v1) or an empty file. */
  | 'no-text'
  /** The file is damaged or could not be read for another reason. */
  | 'failed';

/** A document that could not be read. */
export interface DocumentError {
  /** What went wrong. */
  code: DocumentErrorCode;
  /** The file's name, as the user chose it. */
  name: string;
  /** A sentence for the user saying what happened and what to do. Never contains file text. */
  message: string;
}

/** A document read successfully. */
export interface ExtractedDocument {
  /** The file's name, as the user chose it. */
  name: string;
  /** What kind of file it was. */
  kind: DocumentKind;
  /** The plain text, with whitespace normalised and paragraph breaks kept (see normalizeText). */
  text: string;
  /** Length of `text` in characters. */
  chars: number;
  /** Number of pages (PDFs only; undefined for DOCX and TXT). */
  pages?: number;
}

/** The result of extractText(). */
export type ExtractResult =
  /** The text was read. */
  | {
      /** True: `document` holds the text. */
      ok: true;
      /** The document's text and size. */
      document: ExtractedDocument;
    }
  /** The text could not be read. */
  | {
      /** False: `error` says why. */
      ok: false;
      /** What went wrong. */
      error: DocumentError;
    };

/** Readers for each file type (replaceable in tests). */
export interface ExtractDeps {
  /**
   * Reads a PDF's text page by page.
   *
   * @throws pdf.js errors (a PasswordException for protected files).
   */
  readPdf: (data: Uint8Array) => Promise<{ pages: string[] }>;
  /** Reads a DOCX file's raw text (paragraphs separated by blank lines). */
  readDocx: (data: ArrayBuffer) => Promise<string>;
}

/** MIME types browsers report for each kind (the extension is checked too, see detectKind). */
const MIME_KINDS: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};

/**
 * Works out a file's kind from its extension, or failing that its MIME type. The extension
 * comes first because Windows often reports DOCX files with an empty or generic MIME type.
 *
 * @param file The file's name and MIME type.
 * @returns The kind, or null when Kite cannot read this type.
 * Called from: extractText(); tests
 */
export function detectKind(file: Pick<File, 'name' | 'type'>): DocumentKind | null {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === 'pdf' || extension === 'docx' || extension === 'txt') return extension;
  return extension ? null : (MIME_KINDS[file.type] ?? null);
}

/**
 * Normalises whitespace while keeping paragraph breaks: Windows line ends become "\n"; tabs,
 * non-breaking spaces and runs of spaces become one space; spaces at line ends are removed; three
 * or more line breaks become one blank line; the whole text is trimmed.
 *
 * @param text Raw extracted text.
 * @returns The normalised text.
 * Called from: extractText(); tests
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t  -  　 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reads a PDF's text with pdf.js, one string per page. Each text run is added in reading
 * order; pdf.js marks the end of a line with `hasEOL`.
 *
 * @param data The PDF bytes (pdf.js takes ownership of this buffer).
 * @returns The text of each page.
 * @throws pdf.js errors, for example a PasswordException for a protected file.
 * Called from: extractText() (the default reader)
 */
async function readPdfWithPdfJs(data: Uint8Array): Promise<{ pages: string[] }> {
  const pdfjs = await import('pdfjs-dist/webpack.mjs');
  // Default options. pdf.js 6 removed the old `isEvalSupported` switch (it no longer compiles
  // code from fonts at all), and XFA forms stay off (enableXfa defaults to false). Fonts are not
  // loaded: only text is read, so the "standardFontDataUrl" warning pdf.js may print is harmless.
  const task = pdfjs.getDocument({ data });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
          .join(''),
      );
    }
    return { pages };
  } finally {
    // Frees the worker's copy of the document.
    await task.destroy();
  }
}

/**
 * Reads a DOCX file's raw text with mammoth (browser input: an ArrayBuffer). Tables come out as
 * one paragraph per cell.
 *
 * @param data The DOCX bytes.
 * @returns The raw text.
 * Called from: extractText() (the default reader)
 */
async function readDocxWithMammoth(data: ArrayBuffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  return (await mammoth.extractRawText({ arrayBuffer: data })).value;
}

/** The real readers. */
const DEFAULT_DEPS: ExtractDeps = { readPdf: readPdfWithPdfJs, readDocx: readDocxWithMammoth };

/**
 * Builds a failed result.
 *
 * @param name    The file's name.
 * @param code    What went wrong.
 * @param message A sentence for the user.
 * @returns The result.
 */
function failure(name: string, code: DocumentErrorCode, message: string): ExtractResult {
  return { ok: false, error: { code, name, message } };
}

/**
 * Reads a PDF, DOCX or TXT file into plain text.
 *
 * @param file The file the user picked or dropped.
 * @param deps The readers (tests only).
 * @returns The text with its size, or a DocumentError. Never throws.
 * Called from: the Create/Edit session wizard (Day 3 Stage 3); tests
 */
export async function extractText(
  file: File,
  deps: ExtractDeps = DEFAULT_DEPS,
): Promise<ExtractResult> {
  const { name } = file;
  const kind = detectKind(file);
  if (!kind) {
    return failure(
      name,
      'unsupported-type',
      `${name}: Paramount AI can read PDF, Word (.docx) and text (.txt) files. For an older .doc file, save it as .docx first.`,
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return failure(
      name,
      'too-large',
      `${name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }

  let raw: string;
  let pages: number | undefined;
  try {
    if (kind === 'pdf') {
      const result = await deps.readPdf(new Uint8Array(await file.arrayBuffer()));
      pages = result.pages.length;
      // A blank line between pages, so page boundaries stay paragraph breaks.
      raw = result.pages.join('\n\n');
    } else if (kind === 'docx') {
      raw = await deps.readDocx(await file.arrayBuffer());
    } else {
      // Blob.text() decodes UTF-8 and drops a byte-order mark.
      raw = await file.text();
    }
  } catch (cause) {
    // pdf.js reports a password-protected file with a PasswordException (by name: its classes
    // are not loaded until a PDF is read).
    if (cause instanceof Error && cause.name === 'PasswordException') {
      return failure(
        name,
        'encrypted',
        `${name} is password-protected. Save an unprotected copy and add that instead.`,
      );
    }
    return failure(
      name,
      'failed',
      `${name} could not be read; it may be damaged. Try saving it again, or add it as .txt.`,
    );
  }

  const text = normalizeText(raw);
  if (text === '') {
    return failure(
      name,
      'no-text',
      kind === 'pdf'
        ? `${name} has no text Paramount AI can read; it looks like a scanned document. Reading text from images (OCR) is not supported in v1.`
        : `${name} has no text.`,
    );
  }
  return { ok: true, document: { name, kind, text, chars: text.length, pages } };
}
