/**
 * File: apps/web/src/core/review/pdf.ts
 * Purpose: Writes a plain text PDF by hand: pages of wrapped lines in the PDF standard fonts, with
 *          no dependency. Those fonts cover Western European letters; anything else (for example
 *          Arabic or Chinese in an answer) cannot be drawn, so it shows as "?" and the result says
 *          so. The TXT download keeps every letter.
 * Used by: src/core/review/conversation.ts (the transcript's PDF download)
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0029
 */

/** One paragraph of the document. */
export interface PdfLine {
  /** Its text; it wraps to fit the page. */
  text: string;
  /** True to set it in bold. */
  bold?: boolean;
  /** Indented this many points from the left margin. */
  indent?: number;
}

/** The finished document. */
export interface PdfResult {
  /** The file's bytes. */
  bytes: Uint8Array;
  /** True when some letters could not be drawn and show as "?". */
  lossy: boolean;
}

/** A4 width in points. */
const PAGE_WIDTH = 595;

/** A4 height in points. */
const PAGE_HEIGHT = 842;

/** Space around the text, in points. */
const MARGIN = 50;

/** Text size in points. */
const FONT_SIZE = 10;

/** Distance between lines in points. */
const LEADING = 14;

/**
 * Average width of a character, in points at FONT_SIZE. Generous for Helvetica, so a line of wide
 * letters still fits the page.
 */
const CHAR_WIDTH = 5.2;

/** Characters outside Latin-1 that the PDF's WinAnsi encoding has, with their codes there. */
const WIN_ANSI: Readonly<Record<string, number>> = {
  '€': 0x80,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
};

/**
 * Turns text into WinAnsi characters for a PDF string, escaping what must be escaped.
 *
 * @param text The text.
 * @returns The escaped string (each character a single byte), and whether any letter was lost.
 * Called from: writePdf()
 */
function encode(text: string): { value: string; lossy: boolean } {
  let value = '';
  let lossy = false;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    let byte: number;
    if (WIN_ANSI[character] !== undefined) byte = WIN_ANSI[character];
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) byte = code;
    else if (code === 0x09) byte = 0x20;
    else {
      byte = 0x3f;
      lossy = true;
    }
    const out = String.fromCharCode(byte);
    value += out === '(' || out === ')' || out === '\\' ? `\\${out}` : out;
  }
  return { value, lossy };
}

/**
 * Wraps a paragraph to a width, breaking at spaces, and inside a word only when it alone is too
 * long.
 *
 * @param text     The paragraph.
 * @param maxChars How many characters fit on a line.
 * @returns The lines (at least one, so an empty paragraph keeps its space).
 * Called from: writePdf(); tests
 */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    if (line && line.length + 1 + rest.length > maxChars) {
      lines.push(line);
      line = '';
    }
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    line = line ? `${line} ${rest}` : rest;
  }
  lines.push(line);
  return lines;
}

/**
 * Writes the PDF.
 *
 * @param title Shown as the document's title in PDF readers.
 * @param lines The document's paragraphs, in order.
 * @returns The bytes, and whether any letter was lost.
 * Called from: core/review/conversation.ts; tests
 */
export function writePdf(title: string, lines: readonly PdfLine[]): PdfResult {
  let lossy = false;
  const perPage = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING);
  // Each page's drawing instructions.
  const pages: string[][] = [[]];
  let used = 0;
  for (const line of lines) {
    const indent = line.indent ?? 0;
    const maxChars = Math.floor((PAGE_WIDTH - 2 * MARGIN - indent) / CHAR_WIDTH);
    for (const piece of wrapText(line.text, maxChars)) {
      if (used === perPage) {
        pages.push([]);
        used = 0;
      }
      const encoded = encode(piece);
      lossy ||= encoded.lossy;
      const y = PAGE_HEIGHT - MARGIN - (used + 1) * LEADING;
      pages[pages.length - 1]!.push(
        `BT /${line.bold ? 'F2' : 'F1'} ${FONT_SIZE} Tf ${MARGIN + indent} ${y} Td (${encoded.value}) Tj ET`,
      );
      used += 1;
    }
  }

  // Objects: 1 catalog, 2 page tree, 3 and 4 fonts, 5 info, then a page and its content per page.
  const pageId = (index: number) => 6 + index * 2;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${encode(title).value}) /Producer (Kite) >>`,
  ];
  pages.forEach((page, index) => {
    const content = page.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId(index) + 1} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });

  // Every character is one byte, so string lengths are byte offsets.
  let file = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(file.length);
  for (let i = 0; i < file.length; i += 1) bytes[i] = file.charCodeAt(i);
  return { bytes, lossy };
}
