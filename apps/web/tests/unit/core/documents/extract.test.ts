/**
 * Tests for apps/web/src/core/documents/extract.ts with the invented fixtures in
 * tests/fixtures/documents (see SOURCES.md), read by the real pdf.js (legacy build, see
 * vitest.config.ts) and mammoth (browser bundle): a two-page PDF, a DOCX with a table and a TXT
 * extract as expected, with whitespace normalised and paragraph breaks kept; an encrypted PDF
 * gives 'encrypted', an image-only PDF 'no-text' (with the OCR message), an unknown type
 * 'unsupported-type', a file over 20 MB 'too-large' (ADR-0117) while one of exactly 20 MB is read,
 * a damaged file 'failed' and an empty file 'no-text'. Also detectKind() and normalizeText() on their own.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  detectKind,
  extractText,
  normalizeText,
  type ExtractResult,
} from '@/core/documents/extract';
import { MAX_FILE_BYTES } from '@/core/documents/limits';

/** The committed fixtures. */
const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/documents',
);

/**
 * A browser File holding a fixture's bytes.
 *
 * @param name Fixture file name.
 * @param type MIME type the browser would report ('' = unknown).
 * @returns The file.
 */
function fixture(name: string, type = ''): File {
  return new File([readFileSync(path.join(FIXTURES, name))], name, { type });
}

/**
 * The text of a successful result (fails the test otherwise).
 *
 * @param result What extractText() returned.
 * @returns The extracted document.
 */
function ok(result: ExtractResult) {
  if (!result.ok) throw new Error(`expected text, got ${result.error.code}`);
  return result.document;
}

/**
 * The error code of a failed result (fails the test otherwise).
 *
 * @param result What extractText() returned.
 * @returns The error.
 */
function failed(result: ExtractResult) {
  if (result.ok) throw new Error('expected an error, got text');
  return result.error;
}

// Loading pdf.js the first time (about 1 MB of code) took 5.8 s on a cold run on Day 3, over
// Vitest's 5 s per-test limit; later loads take a few ms. Load it once here, with its own limit,
// so no test's timing depends on whether it ran first.
beforeAll(async () => {
  await import('pdfjs-dist/webpack.mjs');
}, 60_000);

describe('extractText: fixtures', () => {
  it('reads a two-page PDF, one paragraph break between pages', async () => {
    const document = ok(await extractText(fixture('two-pages.pdf', 'application/pdf')));
    expect(document).toMatchObject({ name: 'two-pages.pdf', kind: 'pdf', pages: 2 });
    expect(document.text).toBe(
      'Northwind Logistics pricing overview\nThe professional plan costs 52 dollars per seat.\n\n' +
        'Page two: renewal terms\nBluefin Route renews every twelve months.',
    );
    expect(document.chars).toBe(document.text.length);
  });

  it('reads a DOCX with a table (one paragraph per cell)', async () => {
    const document = ok(await extractText(fixture('table.docx')));
    expect(document).toMatchObject({ kind: 'docx', pages: undefined });
    expect(document.text).toBe(
      'Quarterly review agenda\n\nProduct\n\nSeats\n\nProfessional plan\n\n150\n\n' +
        'Next step: confirm the renewal date.',
    );
  });

  it('reads a TXT file and normalises its whitespace', async () => {
    const document = ok(await extractText(fixture('notes.txt', 'text/plain')));
    expect(document.text).toBe(
      'Call notes\n\nAsk about the Northwind Logistics rollout.\nBudget: 12,000 dollars.',
    );
  });

  it('reports a password-protected PDF as encrypted', async () => {
    const error = failed(await extractText(fixture('encrypted.pdf')));
    expect(error).toMatchObject({ code: 'encrypted', name: 'encrypted.pdf' });
    expect(error.message).toMatch(/password-protected/);
  });

  it('reports an image-only (scanned) PDF as having no text, mentioning OCR', async () => {
    const error = failed(await extractText(fixture('image-only.pdf')));
    expect(error.code).toBe('no-text');
    expect(error.message).toMatch(/OCR/);
  });
});

describe('extractText: other errors', () => {
  it('refuses types it cannot read', async () => {
    for (const name of ['old.doc', 'photo.png', 'deck.pptx']) {
      expect(failed(await extractText(new File(['x'], name))).code).toBe('unsupported-type');
    }
  });

  it('refuses files over the size limit without reading them', async () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.pdf');
    const error = failed(
      await extractText(big, {
        readPdf: () => Promise.reject(new Error('must not be read')),
        readDocx: () => Promise.reject(new Error('must not be read')),
      }),
    );
    expect(error.code).toBe('too-large');
    expect(error.message).toContain('the limit is 20 MB');
  });

  it('reads a file of exactly 20 MB: size is only gate 1, text is checked later (ADR-0117)', async () => {
    const full = new File([new Uint8Array(MAX_FILE_BYTES)], 'full.pdf');
    const document = ok(
      await extractText(full, {
        readPdf: () => Promise.resolve({ pages: ['A large scan with little text.'] }),
        readDocx: () => Promise.reject(new Error('must not be read')),
      }),
    );
    expect(document.chars).toBeLessThan(500_000);
  });

  it('reports a damaged PDF or DOCX as failed', async () => {
    const junk = 'this is not really a document';
    expect(failed(await extractText(new File([junk], 'broken.pdf'))).code).toBe('failed');
    expect(failed(await extractText(new File([junk], 'broken.docx'))).code).toBe('failed');
  });

  it('reports an empty text file as having no text', async () => {
    const error = failed(await extractText(new File([' \r\n\t '], 'empty.txt')));
    expect(error).toMatchObject({ code: 'no-text', message: 'empty.txt has no text.' });
  });
});

describe('detectKind', () => {
  it('uses the extension first (any case), then the MIME type', () => {
    expect(detectKind({ name: 'A.PDF', type: '' })).toBe('pdf');
    expect(detectKind({ name: 'notes.Docx', type: 'application/octet-stream' })).toBe('docx');
    expect(detectKind({ name: 'no-extension', type: 'text/plain' })).toBe('txt');
    // A known extension that Kite cannot read wins over a misleading MIME type.
    expect(detectKind({ name: 'scan.png', type: 'application/pdf' })).toBeNull();
    expect(detectKind({ name: 'no-extension', type: 'image/png' })).toBeNull();
  });
});

describe('normalizeText', () => {
  it('collapses spaces, keeps one blank line between paragraphs and trims', () => {
    expect(normalizeText('  a  b\t c  \r\n\r\n\r\n\r\nd  \n e\n')).toBe('a b c\n\nd\ne');
  });
});
